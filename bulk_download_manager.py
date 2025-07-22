import os
import time
import re
import asyncio
import requests
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from PyQt6.QtCore import QThread, pyqtSignal, QMutex, QMutexLocker, QTimer
from PyQt6.QtWidgets import QMessageBox

from getMetadata import get_filtered_data, parse_uri, SpotifyInvalidUrlException
from qobuzDL import QobuzDownloader
from tidalDL import TidalDownloader
from deezerDL import DeezerDownloader

# Configurazioni avanzate di retry
MAX_METADATA_RETRIES = 5
MAX_DOWNLOAD_RETRIES = 10
INITIAL_RETRY_DELAY = 2
MAX_RETRY_DELAY = 30
BACKOFF_MULTIPLIER = 1.5

@dataclass
class Track:
    """Rappresenta una singola traccia"""
    external_urls: str
    title: str
    artists: str
    album: str
    track_number: int
    duration_ms: int
    id: str
    isrc: str = ""
    preview_url: str = ""

@dataclass
class BulkConfiguration:
    """Configurazione per il bulk download"""
    service: str = "tidal"
    qobuz_region: str = "us"
    deezer_speed: float = 7.5
    output_directory: str = ""
    filename_format: str = "title_artist"
    use_track_numbers: bool = True
    use_album_subfolders: bool = True
    max_concurrent_downloads: int = 1
    retry_404_enabled: bool = True
    retry_404_max_attempts: int = 10
    retry_404_delay: int = 3

@dataclass
class BulkItem:
    """Singolo elemento del bulk download"""
    url: str
    line_number: int
    status: str = "pending"  # pending, processing, downloading, completed, failed
    error_message: str = ""
    retry_count: int = 0
    tracks_count: int = 0
    downloaded_count: int = 0
    failed_tracks: List[Tuple[str, str, str]] = field(default_factory=list)
    item_type: str = ""  # track, album, playlist
    title: str = ""
    output_path: str = ""
    tracks: List[Track] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)

class BulkProgressTracker:
    """Tracker per il progresso globale del bulk download"""
    
    def __init__(self):
        self.total_urls = 0
        self.processed_urls = 0
        self.successful_urls = 0
        self.failed_urls = 0
        self.total_tracks = 0
        self.downloaded_tracks = 0
        self.failed_tracks = 0
        self.current_url_index = 0
        self.start_time = None
        self.current_track_in_url = 0
        
    def start_tracking(self, total_urls: int):
        """Inizia il tracking"""
        self.total_urls = total_urls
        self.start_time = datetime.now()
        
    def update_url_progress(self, processed: int, successful: int, failed: int):
        """Aggiorna il progresso degli URL"""
        self.processed_urls = processed
        self.successful_urls = successful
        self.failed_urls = failed
        
    def update_track_progress(self, total_tracks: int, downloaded: int, failed: int):
        """Aggiorna il progresso dei brani"""
        self.total_tracks = total_tracks
        self.downloaded_tracks = downloaded
        self.failed_tracks = failed
        
    def get_progress_percentage(self) -> float:
        """Calcola la percentuale di completamento"""
        if self.total_urls == 0:
            return 0.0
        return (self.processed_urls / self.total_urls) * 100
        
    def get_track_progress_percentage(self) -> float:
        """Calcola la percentuale di completamento delle tracce"""
        if self.total_tracks == 0:
            return 0.0
        return (self.downloaded_tracks / self.total_tracks) * 100
        
    def get_estimated_time_remaining(self) -> Optional[str]:
        """Calcola il tempo stimato rimanente"""
        if not self.start_time or self.processed_urls == 0:
            return None
            
        elapsed = (datetime.now() - self.start_time).total_seconds()
        rate = self.processed_urls / elapsed
        remaining_urls = self.total_urls - self.processed_urls
        
        if rate > 0:
            remaining_seconds = remaining_urls / rate
            hours, remainder = divmod(remaining_seconds, 3600)
            minutes, seconds = divmod(remainder, 60)
            return f"{int(hours):02d}:{int(minutes):02d}:{int(seconds):02d}"
        return None

class BulkDownloadManager(QThread):
    """Manager principale per il bulk download"""
    
    # Segnali per comunicare con la GUI
    bulk_started = pyqtSignal(int)                        # total_urls
    bulk_progress = pyqtSignal(dict)                      # progress_data
    bulk_completed = pyqtSignal(dict)                     # completion_data
    url_processing = pyqtSignal(int, str, str)            # line_number, status, url
    url_completed = pyqtSignal(int, bool, str)            # line_number, success, message
    track_progress = pyqtSignal(int, str, str, bool)      # line_number, track_name, status, completed
    error_occurred = pyqtSignal(str)                      # error_message
    
    def __init__(self, file_path: str, config: BulkConfiguration):
        super().__init__()
        self.file_path = file_path
        self.config = config
        self.bulk_items: List[BulkItem] = []
        self.progress_tracker = BulkProgressTracker()
        self.is_stopped = False
        self.is_paused = False
        self.downloaders = {}
        
    def stop(self):
        """Ferma tutti i processi di download"""
        self.is_stopped = True
                
    def pause(self):
        """Mette in pausa il processo"""
        self.is_paused = True
                
    def resume(self):
        """Riprende il processo"""
        self.is_paused = False
        
    def run(self):
        """Processo principale del bulk download"""
        try:
            # Carica gli URL dal file
            if not self._load_urls_from_file():
                return
                
            # Inizia il tracking
            self.progress_tracker.start_tracking(len(self.bulk_items))
            self.bulk_started.emit(len(self.bulk_items))
            
            # Inizializza i downloader
            self._initialize_downloaders()
            
            # Processa ogni URL
            for i, item in enumerate(self.bulk_items):
                if self.is_stopped:
                    break
                    
                # Gestione pausa
                while self.is_paused and not self.is_stopped:
                    time.sleep(0.1)
                    
                # Aggiorna progresso URL
                self.progress_tracker.current_url_index = i
                self._emit_progress_update()
                
                # Processa l'URL
                self._process_single_url(item)
            
            # Completion
            self._handle_completion()
            
        except Exception as e:
            self.error_occurred.emit(f"Bulk download error: {str(e)}")
            
    def _load_urls_from_file(self) -> bool:
        """Carica gli URL dal file txt"""
        try:
            with open(self.file_path, 'r', encoding='utf-8') as file:
                lines = file.readlines()
                
            for line_num, line in enumerate(lines, 1):
                url = line.strip()
                if url and not url.startswith('#') and 'spotify.com' in url:
                    self.bulk_items.append(BulkItem(
                        url=url,
                        line_number=line_num
                    ))
                    
            if not self.bulk_items:
                self.error_occurred.emit("No valid Spotify URLs found in file")
                return False
                
            return True
            
        except Exception as e:
            self.error_occurred.emit(f"Failed to load URLs from file: {str(e)}")
            return False
    
    def _initialize_downloaders(self):
        """Inizializza i downloader per i diversi servizi"""
        try:
            if self.config.service == "qobuz":
                self.downloaders['primary'] = QobuzDownloader(self.config.qobuz_region)
            elif self.config.service == "deezer":
                self.downloaders['primary'] = DeezerDownloader()
            else:
                self.downloaders['primary'] = TidalDownloader()
        except Exception as e:
            self.error_occurred.emit(f"Failed to initialize downloaders: {str(e)}")
            
    def _process_single_url(self, item: BulkItem):
        """Processa un singolo URL"""
        try:
            # Step 1: Fetch metadata
            self.url_processing.emit(item.line_number, "Fetching metadata", item.url)
            
            if not self._fetch_metadata_for_item(item):
                return
            
            # Step 2: Prepare output directory
            output_path = self._prepare_output_directory(item)
            item.output_path = output_path
            
            # Step 3: Download tracks
            self.url_processing.emit(item.line_number, "Downloading tracks", item.url)
            self._download_tracks_for_item(item)
            
            # Step 4: Update completion status
            if len(item.failed_tracks) == 0:
                item.status = "completed"
                self.url_completed.emit(item.line_number, True, f"Completed: {item.downloaded_count}/{item.tracks_count} tracks")
            else:
                item.status = "completed_with_errors"
                self.url_completed.emit(item.line_number, False, f"Completed with errors: {item.downloaded_count}/{item.tracks_count} tracks, {len(item.failed_tracks)} failed")
                
        except Exception as e:
            item.status = "failed"
            item.error_message = str(e)
            self.url_completed.emit(item.line_number, False, f"Error: {str(e)}")
            
    def _fetch_metadata_for_item(self, item: BulkItem) -> bool:
        """Fetch metadati per un item con retry"""
        last_error = ""
        retry_delay = INITIAL_RETRY_DELAY
        
        for attempt in range(1, MAX_METADATA_RETRIES + 1):
            if self.is_stopped:
                return False
                
            try:
                self.url_processing.emit(
                    item.line_number, 
                    f"Metadata attempt {attempt}/{MAX_METADATA_RETRIES}", 
                    item.url
                )
                
                metadata = get_filtered_data(item.url)
                
                if "error" in metadata:
                    raise Exception(metadata["error"])
                    
                # Determina il tipo di elemento e estrai le tracce
                url_info = parse_uri(item.url)
                item.item_type = url_info["type"]
                item.metadata = metadata
                
                if item.item_type == "track":
                    item.title = metadata["track"]["name"]
                    item.tracks = self._extract_tracks_from_track_metadata(metadata)
                elif item.item_type == "album":
                    item.title = metadata["album_info"]["name"]
                    item.tracks = self._extract_tracks_from_album_metadata(metadata)
                elif item.item_type == "playlist":
                    item.title = metadata["playlist_info"]["owner"]["name"]
                    item.tracks = self._extract_tracks_from_playlist_metadata(metadata)
                
                item.tracks_count = len(item.tracks)
                
                # Aggiorna il totale delle tracce
                self.progress_tracker.total_tracks += item.tracks_count
                self._emit_progress_update()
                
                return True
                
            except requests.exceptions.HTTPError as e:
                last_error = f"HTTP Error {e.response.status_code}: {str(e)}"
                if e.response.status_code == 404 and self.config.retry_404_enabled:
                    self.url_processing.emit(
                        item.line_number, 
                        f"404 error, retrying in {retry_delay}s... (attempt {attempt})",
                        item.url
                    )
                else:
                    break
            except SpotifyInvalidUrlException as e:
                last_error = f"Invalid Spotify URL: {str(e)}"
                break
            except Exception as e:
                last_error = str(e)
                
            if attempt < MAX_METADATA_RETRIES:
                if not self.is_stopped:
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * BACKOFF_MULTIPLIER, MAX_RETRY_DELAY)
                    
        item.error_message = last_error
        item.status = "failed"
        return False
    
    def _extract_tracks_from_track_metadata(self, metadata: Dict) -> List[Track]:
        """Estrae tracce dai metadati di una singola traccia"""
        track_data = metadata["track"]
        track_id = track_data["external_urls"].split("/")[-1]
        
        return [Track(
            external_urls=track_data["external_urls"],
            title=track_data["name"],
            artists=track_data["artists"],
            album=track_data["album"]["name"],
            track_number=track_data["track_number"],
            duration_ms=track_data.get("duration_ms", 0),
            id=track_id,
            isrc=track_data.get("isrc", ""),
            preview_url=track_data.get("preview_url", "")
        )]
    
    def _extract_tracks_from_album_metadata(self, metadata: Dict) -> List[Track]:
        """Estrae tracce dai metadati di un album"""
        tracks = []
        album_name = metadata["album_info"]["name"]
        
        for track_data in metadata["track_list"]:
            track_id = track_data["external_urls"].split("/")[-1]
            
            tracks.append(Track(
                external_urls=track_data["external_urls"],
                title=track_data["name"],
                artists=track_data["artists"],
                album=album_name,
                track_number=track_data["track_number"],
                duration_ms=track_data.get("duration_ms", 0),
                id=track_id,
                isrc=track_data.get("isrc", ""),
                preview_url=track_data.get("preview_url", "")
            ))
            
        return tracks
    
    def _extract_tracks_from_playlist_metadata(self, metadata: Dict) -> List[Track]:
        """Estrae tracce dai metadati di una playlist"""
        tracks = []
        
        for i, track_data in enumerate(metadata["track_list"], 1):
            track_id = track_data["external_urls"].split("/")[-1]
            
            tracks.append(Track(
                external_urls=track_data["external_urls"],
                title=track_data["name"],
                artists=track_data["artists"],
                album=track_data.get("album_name", ""),
                track_number=i,
                duration_ms=track_data.get("duration_ms", 0),
                id=track_id,
                isrc=track_data.get("isrc", ""),
                preview_url=track_data.get("preview_url", "")
            ))
            
        return tracks
    
    def _prepare_output_directory(self, item: BulkItem) -> str:
        """Prepara la directory di output"""
        base_output = self.config.output_directory
        
        if item.item_type in ["album", "playlist"]:
            # Crea sottodirectory per album/playlist
            safe_name = re.sub(r'[<>:"/\\|?*]', '_', item.title)
            output_path = os.path.join(base_output, safe_name)
            os.makedirs(output_path, exist_ok=True)
            return output_path
        else:
            return base_output
            
    def _download_tracks_for_item(self, item: BulkItem):
        """Download di tutte le tracce per un item"""
        downloader = self.downloaders.get('primary')
        if not downloader:
            raise Exception("No downloader available")
            
        # Setup progress callback
        def progress_callback(current, total):
            if total > 0:
                percent = int((current / total) * 100)
                current_mb = current / (1024 * 1024)
                total_mb = total / (1024 * 1024)
                # Non emettiamo questo specifico progresso per evitare spam
                pass
        
        if hasattr(downloader, 'set_progress_callback'):
            downloader.set_progress_callback(progress_callback)
        
        for i, track in enumerate(item.tracks):
            if self.is_stopped:
                break
                
            # Gestione pausa
            while self.is_paused and not self.is_stopped:
                time.sleep(0.1)
                
            # Aggiorna progresso traccia
            self.track_progress.emit(
                item.line_number,
                track.title,
                f"Downloading ({i+1}/{len(item.tracks)})",
                False
            )
            
            # Prova il download con retry
            success, error_msg = self._download_single_track_with_retry(track, downloader, item)
            
            if success:
                item.downloaded_count += 1
                self.progress_tracker.downloaded_tracks += 1
                self.track_progress.emit(
                    item.line_number,
                    track.title,
                    "Completed",
                    True
                )
            else:
                item.failed_tracks.append((track.title, track.artists, error_msg))
                self.progress_tracker.failed_tracks += 1
                self.track_progress.emit(
                    item.line_number,
                    track.title,
                    f"Failed: {error_msg}",
                    False
                )
                
            # Aggiorna progresso globale
            self._emit_progress_update()
            
    def _download_single_track_with_retry(self, track: Track, downloader, item: BulkItem) -> Tuple[bool, str]:
        """Download di un singolo brano con retry logic per errori 404"""
        retry_delay = self.config.retry_404_delay
        max_attempts = self.config.retry_404_max_attempts if self.config.retry_404_enabled else 1
        
        for attempt in range(1, max_attempts + 1):
            if self.is_stopped:
                return False, "Stopped by user"
                
            try:
                # Prepara il filename
                filename = self._get_formatted_filename(track, item)
                filepath = os.path.join(item.output_path, filename)
                
                # Controlla se il file esiste già
                if os.path.exists(filepath) and os.path.getsize(filepath) > 0:
                    return True, "File already exists"
                
                # Esegue il download basato sul servizio
                downloaded_file = None
                
                if self.config.service == "qobuz":
                    if not track.isrc:
                        return False, "No ISRC available for Qobuz"
                    downloaded_file = downloader.download(
                        track.isrc, 
                        item.output_path,
                        is_paused_callback=lambda: self.is_paused,
                        is_stopped_callback=lambda: self.is_stopped
                    )
                    
                elif self.config.service == "deezer":
                    if not track.isrc:
                        return False, "No ISRC available for Deezer"
                    
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_closed():
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                    except RuntimeError:
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        
                    success = loop.run_until_complete(
                        downloader.download_by_isrc(track.isrc, item.output_path, self.config.deezer_speed)
                    )
                    
                    if success:
                        # Trova il file scaricato più recente
                        import glob
                        flac_files = glob.glob(os.path.join(item.output_path, "*.flac"))
                        if flac_files:
                            downloaded_file = max(flac_files, key=os.path.getctime)
                    else:
                        raise Exception("Deezer download failed")
                        
                elif self.config.service == "tidal":
                    if not track.isrc:
                        return False, "No ISRC available for Tidal"
                    
                    try:
                        loop = asyncio.get_event_loop()
                        if loop.is_closed():
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                    except RuntimeError:
                        loop = asyncio.new_event_loop()
                        asyncio.set_event_loop(loop)
                        
                    result = loop.run_until_complete(
                        downloader.download(
                            query=f"{track.title} {track.artists}",
                            isrc=track.isrc,
                            output_dir=item.output_path,
                            quality="LOSSLESS",
                            is_paused_callback=lambda: self.is_paused,
                            is_stopped_callback=lambda: self.is_stopped
                        )
                    )
                    
                    if isinstance(result, str) and os.path.exists(result):
                        downloaded_file = result
                    elif isinstance(result, dict):
                        if result.get("success") == False:
                            if result.get("error") == "Download stopped by user":
                                return False, "Download stopped by user"
                            else:
                                raise Exception(result.get("error", "Tidal download failed"))
                    else:
                        raise Exception("Tidal download returned unexpected result")
                        
                # Rinomina il file se necessario
                if downloaded_file and os.path.exists(downloaded_file) and downloaded_file != filepath:
                    try:
                        os.rename(downloaded_file, filepath)
                    except OSError:
                        # Se rename fallisce, prova copy + delete
                        import shutil
                        shutil.copy2(downloaded_file, filepath)
                        os.remove(downloaded_file)
                        
                return True, "Download completed"
                
            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 404 and attempt < max_attempts:
                    self.track_progress.emit(
                        item.line_number,
                        track.title,
                        f"404 error, retrying in {retry_delay}s... (attempt {attempt})",
                        False
                    )
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * 1.5, 30)
                    continue
                else:
                    return False, f"HTTP {e.response.status_code}: {str(e)}"
                    
            except Exception as e:
                if attempt < max_attempts and "404" in str(e).lower():
                    self.track_progress.emit(
                        item.line_number,
                        track.title,
                        f"Possible 404 error, retrying in {retry_delay}s... (attempt {attempt})",
                        False
                    )
                    time.sleep(retry_delay)
                    retry_delay = min(retry_delay * 1.5, 30)
                    continue
                else:
                    return False, str(e)
                    
        return False, f"Failed after {max_attempts} attempts"
        
    def _get_formatted_filename(self, track: Track, item: BulkItem) -> str:
        """Genera il nome del file formattato"""
        if self.config.filename_format == "artist_title":
            filename = f"{track.artists} - {track.title}.flac"
        elif self.config.filename_format == "title_only":
            filename = f"{track.title}.flac"
        else:
            filename = f"{track.title} - {track.artists}.flac"
            
        # Aggiungi numero traccia per album
        if (item.item_type == "album" or 
            (item.item_type == "playlist" and self.config.use_album_subfolders)) and \
            self.config.use_track_numbers:
            filename = f"{track.track_number:02d} - {filename}"
            
        return re.sub(r'[<>:"/\\|?*]', '_', filename)
    
    def _emit_progress_update(self):
        """Emette un aggiornamento del progresso"""
        progress_data = {
            'total_urls': self.progress_tracker.total_urls,
            'processed_urls': self.progress_tracker.current_url_index + 1,
            'successful_urls': len([item for item in self.bulk_items[:self.progress_tracker.current_url_index + 1] 
                                   if item.status in ["completed", "completed_with_errors"]]),
            'failed_urls': len([item for item in self.bulk_items[:self.progress_tracker.current_url_index + 1] 
                               if item.status == "failed"]),
            'total_tracks': self.progress_tracker.total_tracks,
            'downloaded_tracks': self.progress_tracker.downloaded_tracks,
            'failed_tracks': self.progress_tracker.failed_tracks,
            'progress_percentage': self.progress_tracker.get_progress_percentage(),
            'track_progress_percentage': self.progress_tracker.get_track_progress_percentage(),
            'estimated_time_remaining': self.progress_tracker.get_estimated_time_remaining()
        }
        
        self.bulk_progress.emit(progress_data)
        
    def _handle_completion(self):
        """Gestisce il completamento del bulk download"""
        completed_items = [item for item in self.bulk_items if item.status in ["completed", "completed_with_errors"]]
        failed_items = [item for item in self.bulk_items if item.status == "failed"]
        
        total_downloaded_tracks = sum(item.downloaded_count for item in self.bulk_items)
        total_failed_tracks = sum(len(item.failed_tracks) for item in self.bulk_items)
        
        completion_data = {
            'total_urls': len(self.bulk_items),
            'successful_urls': len(completed_items),
            'failed_urls': len(failed_items),
            'total_tracks': self.progress_tracker.total_tracks,
            'downloaded_tracks': total_downloaded_tracks,
            'failed_tracks': total_failed_tracks,
            'duration': datetime.now() - self.progress_tracker.start_time if self.progress_tracker.start_time else None
        }
        
        self.bulk_completed.emit(completion_data)