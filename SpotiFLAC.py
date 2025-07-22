import sys
import os
from dataclasses import dataclass
from datetime import datetime
import requests
import re
from packaging import version
import tempfile
import asyncio
from pathlib import Path
import shutil
import atexit
import time

from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLineEdit,
    QLabel, QFileDialog, QListWidget, QTextEdit, QTabWidget, QButtonGroup, QRadioButton,
    QAbstractItemView, QSpacerItem, QSizePolicy, QProgressBar, QCheckBox, QDialog,
    QDialogButtonBox, QComboBox, QStyledItemDelegate, QSlider, QFrame, QListWidgetItem, QMessageBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QUrl, QTimer, QTime, QSettings, QSize, QMutex, QMutexLocker
from PyQt6.QtGui import QIcon, QTextCursor, QDesktopServices, QPixmap, QBrush, QFont
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply
from PyQt6.QtMultimedia import QMediaPlayer, QAudioOutput

from getMetadata import get_filtered_data, parse_uri, SpotifyInvalidUrlException
from qobuzDL import QobuzDownloader
from tidalDL import TidalDownloader
from deezerDL import DeezerDownloader
from bulk_download_manager import BulkDownloadManager, BulkConfiguration

# Configurazioni di retry
MAX_DOWNLOAD_RETRIES = 3
RETRY_DELAY_SECONDS = 2

@dataclass
class Track:
    external_urls: str
    title: str
    artists: str
    album: str
    track_number: int
    duration_ms: int
    id: str
    isrc: str = ""
    preview_url: str = ""
    cached_file: str = ""
    is_downloading: bool = False
    cache_error: str = ""

class CacheDownloadWorker(QThread):
    """Worker per il caching dei brani con retry su 404"""
    track_cached = pyqtSignal(int, str)
    download_progress = pyqtSignal(int, str)
    error_occurred = pyqtSignal(int, str)

    def __init__(self, tracks, cache_dir, service="tidal", qobuz_region="us", deezer_speed=7.5):
        super().__init__()
        self.tracks = tracks
        self.cache_dir = cache_dir
        self.service = service
        self.qobuz_region = qobuz_region
        self.deezer_speed = deezer_speed
        self.download_queue = []
        self.is_running = True
        self.mutex = QMutex()
        os.makedirs(self.cache_dir, exist_ok=True)

    def add_to_queue(self, track_index):
        with QMutexLocker(self.mutex):
            if track_index < len(self.tracks):
                track = self.tracks[track_index]
                if not track.cached_file and not track.is_downloading and not track.cache_error:
                    self.download_queue.append(track_index)
                    track.is_downloading = True

    def stop_worker(self):
        self.is_running = False
        self.quit()
        self.wait()

    def run(self):
        # Inizializza downloader
        if self.service == "qobuz":
            base_downloader = QobuzDownloader(self.qobuz_region)
        elif self.service == "deezer":
            base_downloader = DeezerDownloader()
        else:
            base_downloader = TidalDownloader()

        while self.is_running:
            track_index = None
            with QMutexLocker(self.mutex):
                if self.download_queue:
                    track_index = self.download_queue.pop(0)

            if track_index is not None:
                self._download_with_retry(base_downloader, track_index)
            else:
                self.msleep(100)

    def _download_with_retry(self, downloader, track_index):
        for attempt in range(1, MAX_DOWNLOAD_RETRIES + 1):
            try:
                self.download_progress.emit(track_index, f"Caching (tentativo {attempt}): {self.tracks[track_index].title}")
                self._perform_download(downloader, track_index)
                return
            except requests.exceptions.HTTPError as http_err:
                if http_err.response.status_code == 404 and attempt < MAX_DOWNLOAD_RETRIES:
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
                else:
                    self._handle_error(track_index, str(http_err))
                    return
            except Exception as e:
                if attempt < MAX_DOWNLOAD_RETRIES:
                    time.sleep(RETRY_DELAY_SECONDS)
                    continue
                else:
                    self._handle_error(track_index, str(e))
                    return

    def _perform_download(self, downloader, track_index):
        track = self.tracks[track_index]
        # File di cache
        safe_title = re.sub(r'[<>:"/\\|?*]', '_', track.title)
        safe_artists = re.sub(r'[<>:"/\\|?*]', '_', track.artists)
        filename = f"{safe_title} - {safe_artists}.flac"
        cache_file = os.path.join(self.cache_dir, filename)

        if os.path.exists(cache_file) and os.path.getsize(cache_file) > 0:
            track.cached_file = cache_file
            track.is_downloading = False
            self.track_cached.emit(track_index, cache_file)
            return

        # Seleziona servizio
        if self.service == "qobuz":
            if not track.isrc:
                raise Exception("No ISRC per Qobuz")
            downloaded = downloader.download(
                track.isrc, self.cache_dir,
                is_paused_callback=lambda: False,
                is_stopped_callback=lambda: not self.is_running
            )
        elif self.service == "deezer":
            downloaded = self._download_deezer(track)
        else:
            downloaded = self._download_tidal(track)

        # Sposta nel cache
        if downloaded and os.path.exists(downloaded):
            os.replace(downloaded, cache_file)
            track.cached_file = cache_file
            track.is_downloading = False
            self.track_cached.emit(track_index, cache_file)
        else:
            raise Exception("File scaricato non trovato")

    def _download_deezer(self, track):
        if not track.isrc:
            raise Exception("No ISRC per Deezer")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        success = loop.run_until_complete(
            DeezerDownloader().download_by_isrc(track.isrc, self.cache_dir, self.deezer_speed)
        )
        loop.close()
        if success:
            # trova file .flac più recente
            flacs = list(Path(self.cache_dir).glob("*.flac"))
            return max(flacs, key=lambda p: p.stat().st_ctime) if flacs else None
        raise Exception("Download Deezer fallito")

    def _download_tidal(self, track):
        if not track.isrc:
            raise Exception("No ISRC per Tidal")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        result = loop.run_until_complete(
            TidalDownloader().download(
                query=f"{track.title} {track.artists}",
                isrc=track.isrc,
                output_dir=self.cache_dir,
                quality="LOSSLESS",
                is_paused_callback=lambda: False,
                is_stopped_callback=lambda: not self.is_running
            )
        )
        loop.close()
        if isinstance(result, str) and os.path.exists(result):
            return result
        if isinstance(result, dict) and result.get("success") is False:
            raise Exception(result.get("error", "Errore Tidal"))
        raise Exception("Download Tidal fallito")

    def _handle_error(self, track_index, msg):
        track = self.tracks[track_index]
        track.is_downloading = False
        track.cache_error = msg
        self.error_occurred.emit(track_index, msg)

class MetadataFetchWorker(QThread):
    finished = pyqtSignal(dict)
    error = pyqtSignal(str)
    
    def __init__(self, url):
        super().__init__()
        self.url = url
        
    def run(self):
        try:
            metadata = get_filtered_data(self.url)
            if "error" in metadata:
                self.error.emit(metadata["error"])
            else:
                self.finished.emit(metadata)
        except SpotifyInvalidUrlException as e:
            self.error.emit(str(e))
        except Exception as e:
            self.error.emit(f'Failed to fetch metadata: {str(e)}')

class DownloadWorker(QThread):
    finished = pyqtSignal(bool, str, list)
    progress = pyqtSignal(str, int)
    
    def __init__(self, tracks, outpath, is_single_track=False, is_album=False, is_playlist=False,
                 album_or_playlist_name='', filename_format='title_artist', use_track_numbers=True,
                 use_album_subfolders=False, service="tidal", qobuz_region="us", deezer_speed=7.5, cache_dir=None):
        super().__init__()
        self.tracks = tracks
        self.outpath = outpath
        self.is_single_track = is_single_track
        self.is_album = is_album        
        self.is_playlist = is_playlist
        self.album_or_playlist_name = album_or_playlist_name
        self.filename_format = filename_format
        self.use_track_numbers = use_track_numbers
        self.use_album_subfolders = use_album_subfolders
        self.service = service
        self.qobuz_region = qobuz_region
        self.deezer_speed = deezer_speed
        self.cache_dir = cache_dir
        self.is_paused = False
        self.is_stopped = False
        self.failed_tracks = []

    def get_formatted_filename(self, track):
        if self.filename_format == "artist_title":
            filename = f"{track.artists} - {track.title}.flac"
        elif self.filename_format == "title_only":
            filename = f"{track.title}.flac"
        else:
            filename = f"{track.title} - {track.artists}.flac"
        return re.sub(r'[<>:"/\\|?*]', '_', filename)

    def run(self):
        try:
            if self.service == "qobuz":
                downloader = QobuzDownloader(self.qobuz_region)
            elif self.service == "deezer":
                downloader = DeezerDownloader()
            else:
                downloader = TidalDownloader()
            
            def progress_update(current, total):
                if total > 0:
                    percent = (current / total) * 100
                    current_mb = current / (1024 * 1024)
                    total_mb = total / (1024 * 1024)
                    self.progress.emit(f"Download progress: {percent:.2f}% ({current_mb:.2f}MB/{total_mb:.2f}MB)", 
                                    int(percent))
                else:
                    self.progress.emit(f"Processing metadata...", 0)
            
            downloader.set_progress_callback(progress_update)
            
            total_tracks = len(self.tracks)
            
            for i, track in enumerate(self.tracks):
                while self.is_paused:
                    if self.is_stopped:
                        return
                    self.msleep(100)
                if self.is_stopped:
                    return

                self.progress.emit(f"Starting download ({i+1}/{total_tracks}): {track.title} - {track.artists}", 
                                int((i) / total_tracks * 100))
                
                try:
                    if self.is_playlist and self.use_album_subfolders:
                        album_folder = re.sub(r'[<>:"/\\|?*]', '_', track.album)
                        track_outpath = os.path.join(self.outpath, album_folder)
                        os.makedirs(track_outpath, exist_ok=True)
                    else:
                        track_outpath = self.outpath
                    
                    if (self.is_album or (self.is_playlist and self.use_album_subfolders)) and self.use_track_numbers:
                        new_filename = f"{track.track_number:02d} - {self.get_formatted_filename(track)}"
                    else:
                        new_filename = self.get_formatted_filename(track)
                    
                    new_filename = re.sub(r'[<>:"/\\|?*]', '_', new_filename)
                    new_filepath = os.path.join(track_outpath, new_filename)
                    
                    if os.path.exists(new_filepath) and os.path.getsize(new_filepath) > 0:
                        self.progress.emit(f"File already exists: {new_filename}. Skipping download.", 0)
                        self.progress.emit(f"Skipped: {track.title} - {track.artists}", 
                                    int((i + 1) / total_tracks * 100))
                        continue
                    
                    # Check if file exists in cache first
                    if self.cache_dir and track.cached_file and os.path.exists(track.cached_file):
                        self.progress.emit(f"Using cached file for: {track.title}", 0)
                        try:
                            # Copy from cache to final destination
                            shutil.copy2(track.cached_file, new_filepath)
                            self.progress.emit(f"Successfully copied from cache: {track.title} - {track.artists}", 
                                        int((i + 1) / total_tracks * 100))
                            continue
                        except Exception as e:
                            self.progress.emit(f"Failed to copy from cache, downloading: {str(e)}", 0)
                    
                    # Download normally if not in cache
                    if self.service == "qobuz":
                        if not track.isrc:
                            self.progress.emit(f"No ISRC found for track: {track.title}. Skipping.", 0)
                            self.failed_tracks.append((track.title, track.artists, "No ISRC available"))
                            continue
                        
                        self.progress.emit(f"Getting track from Qobuz with ISRC: {track.isrc}", 0)
                        
                        is_paused_callback = lambda: self.is_paused
                        is_stopped_callback = lambda: self.is_stopped
                        
                        downloaded_file = downloader.download(
                            track.isrc, 
                            track_outpath,
                            is_paused_callback=is_paused_callback,
                            is_stopped_callback=is_stopped_callback
                        )
                    elif self.service == "deezer":
                        if not track.isrc:
                            self.progress.emit(f"No ISRC found for track: {track.title}. Skipping.", 0)
                            self.failed_tracks.append((track.title, track.artists, "No ISRC available"))
                            continue
                        
                        self.progress.emit(f"Downloading from Deezer with ISRC: {track.isrc}", 0)
                        
                        try:
                            loop = asyncio.get_event_loop()
                            if loop.is_closed():
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                        except RuntimeError:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                        
                        success = loop.run_until_complete(downloader.download_by_isrc(track.isrc, track_outpath, self.deezer_speed))
                        
                        if success:
                            safe_title = "".join(c for c in track.title if c.isalnum() or c in (' ', '-', '_')).rstrip()
                            safe_artist = "".join(c for c in track.artists if c.isalnum() or c in (' ', '-', '_')).rstrip()
                            expected_filename = f"{safe_artist} - {safe_title}.flac"
                            downloaded_file = os.path.join(track_outpath, expected_filename)
                            
                            if not os.path.exists(downloaded_file):
                                import glob
                                flac_files = glob.glob(os.path.join(track_outpath, "*.flac"))
                                if flac_files:
                                    downloaded_file = max(flac_files, key=os.path.getctime)
                                else:
                                    raise Exception("Downloaded file not found")
                        else:
                            raise Exception("Deezer download failed")
                    elif self.service == "tidal": 
                        if not track.isrc:
                            self.progress.emit(f"No ISRC found for track: {track.title}. Skipping.", 0)
                            self.failed_tracks.append((track.title, track.artists, "No ISRC available"))
                            continue
                        
                        self.progress.emit(f"Searching and downloading from Tidal for ISRC: {track.isrc} - {track.title} - {track.artists}", 0)
                        
                        is_paused_callback = lambda: self.is_paused
                        is_stopped_callback = lambda: self.is_stopped
                        
                        try:
                            loop = asyncio.get_event_loop()
                            if loop.is_closed():
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                        except RuntimeError:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)

                        download_result_details = loop.run_until_complete(downloader.download(
                            query=f"{track.title} {track.artists}", 
                            isrc=track.isrc,
                            output_dir=track_outpath,
                            quality="LOSSLESS", 
                            is_paused_callback=is_paused_callback,
                            is_stopped_callback=is_stopped_callback
                        ))
                        
                        if isinstance(download_result_details, str) and os.path.exists(download_result_details): 
                            downloaded_file = download_result_details
                        elif isinstance(download_result_details, dict) and download_result_details.get("success") == False and download_result_details.get("error") == "Download stopped by user":
                            self.progress.emit(f"Download stopped by user for: {track.title}",0)
                            return 
                        elif isinstance(download_result_details, dict) and download_result_details.get("success") == False:
                            raise Exception(download_result_details.get("error", "Tidal download failed"))                        
                        elif isinstance(download_result_details, dict) and (download_result_details.get("status") == "all_skipped" or download_result_details.get("status") == "skipped_exists"):
                            self.progress.emit(f"File already exists or skipped: {new_filename}",0)
                            downloaded_file = new_filepath
                        else: 
                            downloaded_file = None 
                            raise Exception(f"Tidal download failed or returned unexpected result: {download_result_details}")                    
                    else: 
                        track_id = track.id
                        self.progress.emit(f"Getting track info for ID: {track_id} from {self.service}", 0)
                        
                        try:
                            loop = asyncio.get_event_loop()
                            if loop.is_closed():
                                loop = asyncio.new_event_loop()
                                asyncio.set_event_loop(loop)
                        except RuntimeError:
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                        
                        metadata = loop.run_until_complete(downloader.get_track_info(track_id, self.service))
                        self.progress.emit(f"Track info received, starting download process", 0)
                        
                        is_paused_callback = lambda: self.is_paused
                        is_stopped_callback = lambda: self.is_stopped
                        
                        downloaded_file = downloader.download(
                            metadata, 
                            track_outpath,
                            is_paused_callback=is_paused_callback,
                            is_stopped_callback=is_stopped_callback
                        )
                    
                    if self.is_stopped: 
                        return

                    # FIXED: Implement the bug fix for file deletion issue
                    if downloaded_file == new_filepath: 
                        self.progress.emit(f"File already exists: {new_filename}", 0)
                        self.progress.emit(f"Skipped: {track.title} - {track.artists}", 
                                    int((i + 1) / total_tracks * 100))
                        continue
                    
                    if downloaded_file and os.path.exists(downloaded_file) and downloaded_file != new_filepath:
                        try:
                            os.rename(downloaded_file, new_filepath)
                            self.progress.emit(f"File renamed to: {new_filename}", 0)
                        except OSError as e:
                            self.progress.emit(f"Warning: Could not rename file {downloaded_file} to {new_filepath}: {str(e)}", 0)
                            # If rename fails, try copy and delete original
                            try:
                                shutil.copy2(downloaded_file, new_filepath)
                                os.remove(downloaded_file)
                                self.progress.emit(f"File copied to: {new_filename}", 0)
                            except OSError:
                                pass
                    elif not downloaded_file or not os.path.exists(downloaded_file):
                        raise Exception(f"Download failed or file not found: {downloaded_file}")
                    
                    self.progress.emit(f"Successfully downloaded: {track.title} - {track.artists}", 
                                    int((i + 1) / total_tracks * 100))
                except Exception as e:
                    self.failed_tracks.append((track.title, track.artists, str(e)))
                    self.progress.emit(f"Failed to download: {track.title} - {track.artists}\nError: {str(e)}", 
                                    int((i + 1) / total_tracks * 100))
                    continue

            if not self.is_stopped:
                success_message = "Download completed!"
                if self.failed_tracks:
                    success_message += f"\n\nFailed downloads: {len(self.failed_tracks)} tracks"
                self.finished.emit(True, success_message, self.failed_tracks)
                
        except Exception as e:
            self.finished.emit(False, str(e), self.failed_tracks)

    def pause(self):
        self.is_paused = True
        self.progress.emit("Download process paused.", 0)

    def resume(self):
        self.is_paused = False
        self.progress.emit("Download process resumed.", 0)

    def stop(self): 
        self.is_stopped = True
        self.is_paused = False

class UpdateDialog(QDialog):
    def __init__(self, current_version, new_version, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Update Available")
        self.setFixedWidth(400)
        self.setModal(True)

        layout = QVBoxLayout()

        message = QLabel(f"A new version of SpotiFLAC is available!\n\n"
                        f"Current version: v{current_version}\n"
                        f"New version: v{new_version}")
        message.setWordWrap(True)
        layout.addWidget(message)

        self.disable_check = QCheckBox("Turn off update checking")
        self.disable_check.setCursor(Qt.CursorShape.PointingHandCursor)
        layout.addWidget(self.disable_check)

        button_box = QDialogButtonBox()
        self.update_button = QPushButton("Update")
        self.update_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cancel_button = QPushButton("Cancel")
        self.cancel_button.setCursor(Qt.CursorShape.PointingHandCursor)
        
        button_box.addButton(self.update_button, QDialogButtonBox.ButtonRole.AcceptRole)
        button_box.addButton(self.cancel_button, QDialogButtonBox.ButtonRole.RejectRole)
        
        layout.addWidget(button_box)

        self.setLayout(layout)

        self.update_button.clicked.connect(self.accept)
        self.cancel_button.clicked.connect(self.reject)

class TidalStatusChecker(QThread):
    status_updated = pyqtSignal(bool)
    error = pyqtSignal(str)

    def run(self):
        try:
            response = requests.get("https://hifi.401658.xyz", timeout=5)
            is_online = response.status_code == 200 or response.status_code == 429
            self.status_updated.emit(is_online)
        except Exception as e:
            self.error.emit(f"Error checking Tidal (API) status: {str(e)}")
            self.status_updated.emit(False)

class QobuzStatusChecker(QThread):
    status_updated = pyqtSignal(bool)
    error = pyqtSignal(str)
    
    def __init__(self, region="us"):
        super().__init__()
        self.region = region
    
    def run(self):
        try:
            response = requests.get(f"https://{self.region}.qobuz.squid.wtf", timeout=5)
            self.status_updated.emit(response.status_code == 200)
        except Exception as e:
            self.error.emit(f"Error checking Qobuz status: {str(e)}")
            self.status_updated.emit(False)

class DeezerStatusChecker(QThread):
    status_updated = pyqtSignal(bool)
    error = pyqtSignal(str)

    def run(self):
        try:
            response = requests.get("https://deezmate.com/", timeout=5)
            is_online = response.status_code == 200
            self.status_updated.emit(is_online)
        except Exception as e:
            self.error.emit(f"Error checking Deezer status: {str(e)}")
            self.status_updated.emit(False)

class StatusIndicatorDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        item_data = index.data(Qt.ItemDataRole.UserRole)
        is_online = item_data.get('online', False) if item_data else False
        
        super().paint(painter, option, index)
        
        indicator_color = Qt.GlobalColor.green if is_online else Qt.GlobalColor.red
        
        circle_size = 6
        circle_y = option.rect.center().y() - circle_size // 2
        circle_x = option.rect.right() - circle_size - 10
        
        painter.save()
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QBrush(indicator_color))
        painter.drawEllipse(circle_x, circle_y, circle_size, circle_size)
        painter.restore()

class ServiceComboBox(QComboBox):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setIconSize(QSize(16, 16))
        self.setMinimumHeight(35)
        self.services_status = {}
        
        self.setItemDelegate(StatusIndicatorDelegate())
        self.setup_items()
        
        # Tidal status checker
        self.tidal_status_checker = TidalStatusChecker()
        self.tidal_status_checker.status_updated.connect(self.update_tidal_service_status) 
        self.tidal_status_checker.error.connect(lambda e: print(f"Tidal status check error: {e}")) 
        self.tidal_status_checker.start()

        self.tidal_status_timer = QTimer(self)
        self.tidal_status_timer.timeout.connect(self.refresh_tidal_status) 
        self.tidal_status_timer.start(6000)
        
        # Deezer status checker
        self.deezer_status_checker = DeezerStatusChecker()
        self.deezer_status_checker.status_updated.connect(self.update_deezer_service_status) 
        self.deezer_status_checker.error.connect(lambda e: print(f"Deezer status check error: {e}")) 
        self.deezer_status_checker.start()

        self.deezer_status_timer = QTimer(self)
        self.deezer_status_timer.timeout.connect(self.refresh_deezer_status) 
        self.deezer_status_timer.start(6000)
        
    def setup_items(self):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        
        self.services = [
            {'id': 'qobuz', 'name': 'Qobuz', 'icon': 'qobuz.png', 'online': False},
            {'id': 'tidal', 'name': 'Tidal', 'icon': 'tidal.png', 'online': False},
            {'id': 'deezer', 'name': 'Deezer', 'icon': 'deezer.png', 'online': False}
        ]
        
        for service in self.services:
            icon_path = os.path.join(current_dir, service['icon'])
            if not os.path.exists(icon_path):
                self.create_placeholder_icon(icon_path)
            
            icon = QIcon(icon_path)
            
            self.addItem(icon, service['name'])
            item_index = self.count() - 1
            self.setItemData(item_index, service['id'], Qt.ItemDataRole.UserRole + 1)
            self.setItemData(item_index, service, Qt.ItemDataRole.UserRole)

    def create_placeholder_icon(self, path):
        pixmap = QPixmap(16, 16)
        pixmap.fill(Qt.GlobalColor.transparent)
        pixmap.save(path)

    def update_tidal_service_status(self, is_online): 
        for i in range(self.count()):
            service_id = self.itemData(i, Qt.ItemDataRole.UserRole + 1)
            if service_id == 'tidal': 
                service_data = self.itemData(i, Qt.ItemDataRole.UserRole)
                if isinstance(service_data, dict):
                    service_data['online'] = is_online
                    self.setItemData(i, service_data, Qt.ItemDataRole.UserRole)
                break 
        self.update()
        
    def refresh_tidal_status(self):
        self.tidal_status_checker = TidalStatusChecker() 
        self.tidal_status_checker.status_updated.connect(self.update_tidal_service_status)
        self.tidal_status_checker.error.connect(lambda e: print(f"Tidal status check error: {e}")) 
        self.tidal_status_checker.start()
        
    def update_deezer_service_status(self, is_online): 
        for i in range(self.count()):
            service_id = self.itemData(i, Qt.ItemDataRole.UserRole + 1)
            if service_id == 'deezer': 
                service_data = self.itemData(i, Qt.ItemDataRole.UserRole)
                if isinstance(service_data, dict):
                    service_data['online'] = is_online
                    self.setItemData(i, service_data, Qt.ItemDataRole.UserRole)
                break 
        self.update()
        
    def refresh_deezer_status(self):
        self.deezer_status_checker = DeezerStatusChecker() 
        self.deezer_status_checker.status_updated.connect(self.update_deezer_service_status)
        self.deezer_status_checker.error.connect(lambda e: print(f"Deezer status check error: {e}")) 
        self.deezer_status_checker.start()
        
    def currentData(self, role=Qt.ItemDataRole.UserRole + 1):
        return super().currentData(role)

    def update_qobuz_status(self, region_id, is_online):
        for i in range(self.count()):
            service_id = self.itemData(i, Qt.ItemDataRole.UserRole + 1)
            
            if service_id == 'qobuz':
                service_data = self.itemData(i, Qt.ItemDataRole.UserRole)
                if isinstance(service_data, dict):
                    if is_online or service_data.get('online', False):
                        service_data['online'] = True
                        self.setItemData(i, service_data, Qt.ItemDataRole.UserRole)
                break
        
        self.update()

class QobuzRegionComboBox(QComboBox):
    status_updated = pyqtSignal(str, bool)
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setIconSize(QSize(16, 16))
        self.setMinimumHeight(35)
        
        self.setItemDelegate(StatusIndicatorDelegate())
        
        self.setup_items()
        
        self.status_checkers = {}
        self.check_status()
        
        self.status_timer = QTimer(self)
        self.status_timer.timeout.connect(self.check_status)
        self.status_timer.start(10000)
        
    def setup_items(self):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        
        self.regions = [
            {'id': 'eu', 'name': 'Europe', 'icon': 'eu.svg', 'online': False},
            {'id': 'us', 'name': 'North America', 'icon': 'us.svg', 'online': False}
        ]
        
        for region in self.regions:
            icon_path = os.path.join(current_dir, region['icon'])
            if not os.path.exists(icon_path):
                self.create_placeholder_icon(icon_path)
            
            icon = QIcon(icon_path)
            
            self.addItem(icon, region['name'])
            item_index = self.count() - 1
            self.setItemData(item_index, region['id'], Qt.ItemDataRole.UserRole + 1)
            self.setItemData(item_index, region, Qt.ItemDataRole.UserRole)
    
    def create_placeholder_icon(self, path):
        pixmap = QPixmap(16, 16)
        pixmap.fill(Qt.GlobalColor.transparent)
        pixmap.save(path)
    
    def update_region_status(self, region_id, is_online):
        for i in range(self.count()):
            current_region_id = self.itemData(i, Qt.ItemDataRole.UserRole + 1)
            
            if current_region_id == region_id:
                region_data = self.itemData(i, Qt.ItemDataRole.UserRole)
                if isinstance(region_data, dict):
                    region_data['online'] = is_online
                    self.setItemData(i, region_data, Qt.ItemDataRole.UserRole)
                break
        
        self.update()
    
    def check_status(self):
        for region in self.regions:
            region_id = region['id']
            checker = QobuzStatusChecker(region_id)
            checker.status_updated.connect(lambda status, rid=region_id: self.handle_status_update(rid, status))
            checker.start()
            self.status_checkers[region_id] = checker
    
    def handle_status_update(self, region_id, is_online):
        self.update_region_status(region_id, is_online)
        self.status_updated.emit(region_id, is_online)
        
    def currentData(self, role=Qt.ItemDataRole.UserRole + 1):
        return super().currentData(role)

class MediaPlayer(QWidget):
    track_changed = pyqtSignal(int)  # Signal emitted when track changes
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent_widget = parent
        self.current_track_index = 0
        self.tracks = []
        self.cache_worker = None
        self.cache_dir = os.path.join(tempfile.gettempdir(), "spotiflac_cache")
        self.service = "tidal"
        self.qobuz_region = "us"
        self.deezer_speed = 7.5
        self.was_playing = False  # Track if we were playing before track change
        self.auto_play_attempts = 0  # Counter for auto-play attempts
        self.max_auto_play_attempts = 10  # Maximum attempts before giving up
        
        # Create cache directory
        os.makedirs(self.cache_dir, exist_ok=True)
        
        # Setup media player
        self.media_player = QMediaPlayer()
        self.audio_output = QAudioOutput()
        self.media_player.setAudioOutput(self.audio_output)
        
        # Connect signals
        self.media_player.positionChanged.connect(self.position_changed)
        self.media_player.durationChanged.connect(self.duration_changed)
        self.media_player.mediaStatusChanged.connect(self.media_status_changed)
        self.media_player.playbackStateChanged.connect(self.playback_state_changed)
        
        self.setup_ui()
        self.hide()
        
    def setup_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(5, 5, 5, 5)
        layout.setSpacing(8)
        
        # Current track info
        self.track_info = QLabel("No track loaded")
        self.track_info.setStyleSheet("font-weight: bold; font-size: 13px;")
        self.track_info.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.track_info)
        
        # Cache status
        self.cache_status = QLabel("")
        self.cache_status.setStyleSheet("font-size: 10px; color: #666;")
        self.cache_status.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.cache_status)
        
        # Progress bar
        self.progress_slider = QSlider(Qt.Orientation.Horizontal)
        self.progress_slider.setMinimum(0)
        self.progress_slider.setMaximum(100)
        self.progress_slider.sliderMoved.connect(self.set_position)
        layout.addWidget(self.progress_slider)
        
        # Time labels
        time_layout = QHBoxLayout()
        self.time_current = QLabel("00:00")
        self.time_total = QLabel("00:00")
        time_layout.addWidget(self.time_current)
        time_layout.addStretch()
        time_layout.addWidget(self.time_total)
        layout.addLayout(time_layout)
        
        # Control buttons
        controls_layout = QHBoxLayout()
        controls_layout.setSpacing(5)
        
        self.prev_btn = QPushButton("⏮")
        self.prev_btn.setFixedSize(40, 40)
        self.prev_btn.setStyleSheet(self.get_button_style())
        self.prev_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.prev_btn.clicked.connect(self.previous_track)
        
        self.play_pause_btn = QPushButton("▶")
        self.play_pause_btn.setFixedSize(50, 50)
        self.play_pause_btn.setStyleSheet(self.get_button_style())
        self.play_pause_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.play_pause_btn.clicked.connect(self.toggle_playback)
        
        self.stop_btn = QPushButton("⏹")
        self.stop_btn.setFixedSize(40, 40)
        self.stop_btn.setStyleSheet(self.get_button_style())
        self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.stop_btn.clicked.connect(self.stop_playback)
        
        self.next_btn = QPushButton("⏭")
        self.next_btn.setFixedSize(40, 40)
        self.next_btn.setStyleSheet(self.get_button_style())
        self.next_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.next_btn.clicked.connect(self.next_track)
        
        # Volume control
        self.volume_slider = QSlider(Qt.Orientation.Horizontal)
        self.volume_slider.setMinimum(0)
        self.volume_slider.setMaximum(100)
        self.volume_slider.setValue(50)
        self.volume_slider.setMaximumWidth(80)
        self.volume_slider.valueChanged.connect(self.set_volume)
        
        volume_label = QLabel("🔊")
        
        controls_layout.addStretch()
        controls_layout.addWidget(self.prev_btn)
        controls_layout.addWidget(self.play_pause_btn)
        controls_layout.addWidget(self.stop_btn)
        controls_layout.addWidget(self.next_btn)
        controls_layout.addStretch()
        controls_layout.addWidget(volume_label)
        controls_layout.addWidget(self.volume_slider)
        
        layout.addLayout(controls_layout)
        
        # Add separator line
        separator = QFrame()
        separator.setFrameShape(QFrame.Shape.HLine)
        separator.setFrameShadow(QFrame.Shadow.Sunken)
        layout.addWidget(separator)
        
        self.setLayout(layout)
        self.setFixedHeight(160)
        
    def get_button_style(self):
        return """
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 20px;
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """
    
    def set_service_settings(self, service, qobuz_region, deezer_speed=7.5):
        """Update service settings for cache worker"""
        self.service = service
        self.qobuz_region = qobuz_region
        self.deezer_speed = deezer_speed
        
        if self.cache_worker:
            self.cache_worker.stop_worker()
            self.cache_worker = None
    
    def load_tracks(self, tracks):
        self.tracks = tracks
        self.current_track_index = 0
        
        # Stop existing cache worker
        if self.cache_worker:
            self.cache_worker.stop_worker()
            self.cache_worker = None
        
        if tracks:
            # Start cache worker
            self.cache_worker = CacheDownloadWorker(
                self.tracks, 
                self.cache_dir, 
                self.service, 
                self.qobuz_region,
                self.deezer_speed
            )
            self.cache_worker.track_cached.connect(self.on_track_cached)
            self.cache_worker.download_progress.connect(self.on_cache_progress)
            self.cache_worker.error_occurred.connect(self.on_cache_error)
            self.cache_worker.start()
            
            self.load_current_track()
            self.show()
    
    def load_current_track(self):
        if not self.tracks or self.current_track_index >= len(self.tracks):
            return
            
        current_track = self.tracks[self.current_track_index]
        self.track_info.setText(f"{current_track.title} - {current_track.artists}")
        
        # Update track list selection in parent
        if hasattr(self.parent_widget, 'track_list'):
            self.parent_widget.track_list.setCurrentRow(self.current_track_index)
        
        # Cache current track if not already cached
        if not current_track.cached_file and not current_track.cache_error and self.cache_worker:
            self.cache_worker.add_to_queue(self.current_track_index)
        
        # Pre-cache next track
        if self.current_track_index + 1 < len(self.tracks) and self.cache_worker:
            next_track = self.tracks[self.current_track_index + 1]
            if not next_track.cached_file and not next_track.cache_error:
                self.cache_worker.add_to_queue(self.current_track_index + 1)
        
        # Try to load current track if cached
        if current_track.cached_file and os.path.exists(current_track.cached_file):
            self.media_player.setSource(QUrl.fromLocalFile(current_track.cached_file))
            self.cache_status.setText("Ready to play")
        elif current_track.cache_error:
            self.cache_status.setText(f"Cache error: {current_track.cache_error}")
        else:
            self.cache_status.setText("Caching...")
            
        # Emit track changed signal
        self.track_changed.emit(self.current_track_index)
    
    def on_track_cached(self, track_index, file_path):
        """Called when a track is cached"""
        if track_index < len(self.tracks):
            self.tracks[track_index].cached_file = file_path
            
            # If this is the current track, load it
            if track_index == self.current_track_index:
                self.media_player.setSource(QUrl.fromLocalFile(file_path))
                self.cache_status.setText("Ready to play")
                
                # If we were playing and waiting for this track, start playing
                if self.was_playing:
                    self.auto_play_attempts = 0
                    QTimer.singleShot(200, self.auto_play_when_ready)
    
    def on_cache_progress(self, track_index, message):
        """Called during caching progress"""
        if track_index == self.current_track_index:
            self.cache_status.setText(message)
    
    def on_cache_error(self, track_index, error_message):
        """Called when caching fails"""
        if track_index < len(self.tracks):
            self.tracks[track_index].cache_error = error_message
            
        if track_index == self.current_track_index:
            self.cache_status.setText(f"Cache error: {error_message}")
            self.was_playing = False  # Stop trying to auto-play
    
    def toggle_playback(self):
        current_track = self.tracks[self.current_track_index] if self.tracks else None
        
        if current_track and current_track.cached_file and os.path.exists(current_track.cached_file):
            if self.media_player.playbackState() == QMediaPlayer.PlaybackState.PlayingState:
                self.media_player.pause()
                self.was_playing = False
            else:
                self.media_player.play()
                self.was_playing = True
        else:
            if not current_track.cache_error:
                self.cache_status.setText("Track not cached yet...")
                # Set flag to play when ready
                self.was_playing = True
    
    def playback_state_changed(self, state):
        """Handle playback state changes"""
        if state == QMediaPlayer.PlaybackState.PlayingState:
            self.play_pause_btn.setText("⏸")
        else:
            self.play_pause_btn.setText("▶")
    
    def stop_playback(self):
        self.media_player.stop()
        self.was_playing = False
        self.play_pause_btn.setText("▶")
        self.progress_slider.setValue(0)
        self.time_current.setText("00:00")
    
    def previous_track(self):
        if self.current_track_index > 0:
            # Remember if we were playing
            was_playing_before = self.media_player.playbackState() == QMediaPlayer.PlaybackState.PlayingState
            self.was_playing = was_playing_before
            
            self.current_track_index -= 1
            self.load_current_track()
    
    def next_track(self):
        if self.current_track_index < len(self.tracks) - 1:
            # Remember if we were playing
            was_playing_before = self.media_player.playbackState() == QMediaPlayer.PlaybackState.PlayingState
            self.was_playing = was_playing_before
            
            self.current_track_index += 1
            self.load_current_track()
    
    def auto_play_when_ready(self):
        """Auto-play when track is ready"""
        if not self.was_playing:
            return
            
        current_track = self.tracks[self.current_track_index] if self.tracks else None
        
        if current_track and current_track.cached_file and os.path.exists(current_track.cached_file):
            # Check if media is loaded
            if self.media_player.mediaStatus() == QMediaPlayer.MediaStatus.LoadedMedia:
                self.media_player.play()
                self.auto_play_attempts = 0
                return
            elif self.media_player.mediaStatus() == QMediaPlayer.MediaStatus.InvalidMedia:
                print(f"Invalid media for track: {current_track.title}")
                self.was_playing = False
                return
        
        # Retry if we haven't exceeded max attempts
        self.auto_play_attempts += 1
        if self.auto_play_attempts < self.max_auto_play_attempts:
            QTimer.singleShot(300, self.auto_play_when_ready)
        else:
            print(f"Max auto-play attempts reached for track: {current_track.title if current_track else 'Unknown'}")
            self.was_playing = False
            self.auto_play_attempts = 0
    
    def set_position(self, position):
        if self.media_player.duration() > 0:
            self.media_player.setPosition(position * self.media_player.duration() // 100)
    
    def set_volume(self, volume):
        self.audio_output.setVolume(volume / 100.0)
    
    def position_changed(self, position):
        if self.media_player.duration() > 0:
            progress = int((position / self.media_player.duration()) * 100)
            self.progress_slider.setValue(progress)
            
        self.time_current.setText(self.format_time(position))
    
    def duration_changed(self, duration):
        self.time_total.setText(self.format_time(duration))
    
    def media_status_changed(self, status):
        # Auto-advance to next track when current track ends
        if status == QMediaPlayer.MediaStatus.EndOfMedia:
            if self.current_track_index < len(self.tracks) - 1:
                self.next_track()
            else:
                self.stop_playback()
    
    def format_time(self, ms):
        s = int(ms / 1000)
        m, s = divmod(s, 60)
        return f"{m:02d}:{s:02d}"
    
    def cleanup(self):
        """Cleanup cache worker"""
        if self.cache_worker:
            self.cache_worker.stop_worker()
            self.cache_worker = None

def cleanup_cache_on_exit():
    """Clean up cache directory on application exit"""
    cache_dir = os.path.join(tempfile.gettempdir(), "spotiflac_cache")
    if os.path.exists(cache_dir):
        try:
            shutil.rmtree(cache_dir)
            print(f"Cache directory cleaned: {cache_dir}")
        except Exception as e:
            print(f"Failed to clean cache directory: {e}")

# Register cleanup function to be called on exit
atexit.register(cleanup_cache_on_exit)

class SpotiFLACGUI(QWidget):
    def __init__(self):
        super().__init__()
        self.current_version = "4.0"
        self.tracks = []
        self.all_tracks = []  # NEW: Store all tracks for filtering
        self.reset_state()
        
        self.settings = QSettings('SpotiFLAC', 'Settings')
        self.last_output_path = self.settings.value('output_path', os.path.expanduser("~\\Music"))
        self.last_url = self.settings.value('spotify_url', '')
        
        self.filename_format = self.settings.value('filename_format', 'title_artist')
        self.use_track_numbers = self.settings.value('use_track_numbers', False, type=bool)
        self.use_album_subfolders = self.settings.value('use_album_subfolders', False, type=bool)
        self.service = self.settings.value('service', 'tidal')
        self.qobuz_region = self.settings.value('qobuz_region', 'us')
        self.deezer_speed = self.settings.value('deezer_speed', 7.5, type=float)  # NEW: Deezer speed
        self.check_for_updates = self.settings.value('check_for_updates', True, type=bool)
        
        # Bulk download settings
        self.bulk_manager = None
        self.bulk_file_path = self.settings.value('bulk_file_path', '')
        
        self.elapsed_time = QTime(0, 0, 0)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_timer)
        
        self.network_manager = QNetworkAccessManager()
        self.network_manager.finished.connect(self.on_cover_loaded)
        
        self.initUI()
        
        if self.check_for_updates:
            QTimer.singleShot(0, self.check_updates)

    def closeEvent(self, event):
        """Handle application close event"""
        # Stop bulk download if running
        if hasattr(self, 'bulk_manager') and self.bulk_manager and hasattr(self.bulk_manager, 'stop'):
            self.bulk_manager.stop()
        
        if hasattr(self, 'media_player') and self.media_player:
            self.media_player.cleanup()
        # Cache cleanup is handled by atexit
        event.accept()

    def check_updates(self):
        try:
            response = requests.get("https://raw.githubusercontent.com/afkarxyz/SpotiFLAC/refs/heads/main/version.json")
            if response.status_code == 200:
                data = response.json()
                new_version = data.get("version")
                
                if new_version and version.parse(new_version) > version.parse(self.current_version):
                    dialog = UpdateDialog(self.current_version, new_version, self)
                    result = dialog.exec()
                    
                    if dialog.disable_check.isChecked():
                        self.settings.setValue('check_for_updates', False)
                        self.check_for_updates = False
                    if result == QDialog.DialogCode.Accepted:
                        QDesktopServices.openUrl(QUrl("https://github.com/afkarxyz/SpotiFLAC/releases"))
                        
        except Exception as e:
            pass

    @staticmethod
    def format_duration(ms):
        minutes = ms // 60000
        seconds = (ms % 60000) // 1000
        return f"{minutes}:{seconds:02d}"
    
    def reset_state(self):
        self.tracks.clear()
        self.all_tracks.clear()  # NEW: Clear all tracks too
        self.is_album = False
        self.is_playlist = False 
        self.is_single_track = False
        self.album_or_playlist_name = ''

    def reset_ui(self):
        self.track_list.clear()
        self.log_output.clear()
        self.progress_bar.setValue(0)
        self.progress_bar.hide()
        self.stop_btn.hide()
        self.pause_resume_btn.hide()
        self.pause_resume_btn.setText('Pause')
        self.reset_info_widget()
        self.hide_track_buttons()
        self.media_player.hide()
        # NEW: Clear search and hide search widget
        if hasattr(self, 'search_input'):
            self.search_input.clear()
        if hasattr(self, 'search_widget'):
            self.search_widget.hide()

    def initUI(self):
        self.setWindowTitle('SpotiFLAC')
        self.setFixedWidth(1250)  # NEW: Fixed width from original
        self.setMinimumHeight(750)  # NEW: Minimum height from original
        
        icon_path = os.path.join(os.path.dirname(__file__), "icon.svg")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))
            
        self.main_layout = QVBoxLayout()
        
        self.setup_spotify_section()
        self.setup_media_player()
        self.setup_tabs()
        
        self.setLayout(self.main_layout)

    def setup_spotify_section(self):
        spotify_layout = QHBoxLayout()
        spotify_label = QLabel('Spotify URL:')
        spotify_label.setFixedWidth(100)
        
        self.spotify_url = QLineEdit()
        self.spotify_url.setPlaceholderText("Please enter the Spotify URL")
        self.spotify_url.setClearButtonEnabled(True)
        self.spotify_url.setText(self.last_url)
        self.spotify_url.textChanged.connect(self.save_url)
        self.spotify_url.setMinimumHeight(35)
        
        self.fetch_btn = QPushButton('Fetch')
        self.fetch_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.fetch_btn.clicked.connect(self.fetch_tracks)
        self.fetch_btn.setMinimumHeight(35)
        self.fetch_btn.setStyleSheet("""
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 5px;
                font-weight: bold;
                padding: 8px 16px;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """)
        
        spotify_layout.addWidget(spotify_label)
        spotify_layout.addWidget(self.spotify_url)
        spotify_layout.addWidget(self.fetch_btn)
        self.main_layout.addLayout(spotify_layout)

    def setup_media_player(self):
        self.media_player = MediaPlayer(self)
        self.media_player.track_changed.connect(self.on_media_player_track_changed)
        self.main_layout.addWidget(self.media_player)

    def on_media_player_track_changed(self, track_index):
        """Handle track change from media player"""
        if hasattr(self, 'track_list') and self.track_list:
            # NEW: Need to map from displayed tracks to actual track index
            if track_index < len(self.tracks):
                # Find the corresponding row in the displayed list
                for row in range(self.track_list.count()):
                    if row < len(self.tracks):
                        self.track_list.setCurrentRow(row)
                        break

    # NEW: Filter functionality from original
    def filter_tracks(self):
        search_text = self.search_input.text().lower().strip()
        
        if not search_text:
            self.tracks = self.all_tracks.copy()
        else:
            self.tracks = [
                track for track in self.all_tracks
                if (search_text in track.title.lower() or 
                    search_text in track.artists.lower() or 
                    search_text in track.album.lower())
            ]
        
        self.update_track_list_display()
        
        # Update media player with filtered tracks
        if self.tracks:
            self.media_player.load_tracks(self.tracks)

    # NEW: Update track list display
    def update_track_list_display(self):
        self.track_list.clear()
        for i, track in enumerate(self.tracks, 1):
            duration = self.format_duration(track.duration_ms)
            self.track_list.addItem(f"{i}. {track.title} - {track.artists} • {duration}")

    def browse_output(self):
        directory = QFileDialog.getExistingDirectory(self, "Select Output Directory")
        if directory:
            self.output_dir.setText(directory)
            self.save_settings()

    def setup_tabs(self):
        self.tab_widget = QTabWidget()
        self.main_layout.addWidget(self.tab_widget)

        self.setup_dashboard_tab()
        self.setup_bulk_download_tab()  # NUOVO TAB
        self.setup_process_tab()
        self.setup_settings_tab()
        self.setup_about_tab()

    def setup_dashboard_tab(self):
        dashboard_tab = QWidget()
        dashboard_layout = QVBoxLayout()

        self.setup_info_widget()
        dashboard_layout.addWidget(self.info_widget)

        self.track_list = QListWidget()
        self.track_list.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        self.track_list.itemDoubleClicked.connect(self.on_track_double_clicked)
        dashboard_layout.addWidget(self.track_list)
        
        self.setup_track_buttons()
        dashboard_layout.addLayout(self.btn_layout)

        dashboard_tab.setLayout(dashboard_layout)
        self.tab_widget.addTab(dashboard_tab, "Dashboard")

        self.hide_track_buttons()

    def setup_bulk_download_tab(self):
        """Setup tab per il bulk download"""
        bulk_tab = QWidget()
        bulk_layout = QVBoxLayout()
        bulk_layout.setSpacing(15)
        bulk_layout.setContentsMargins(20, 20, 20, 20)

        # Header
        header_label = QLabel("Bulk Download")
        header_label.setStyleSheet("font-size: 18px; font-weight: bold; margin-bottom: 10px;")
        bulk_layout.addWidget(header_label)

        # Descrizione
        desc_label = QLabel("Select a TXT file containing Spotify URLs (one per line) to download multiple playlists, albums, or tracks.")
        desc_label.setWordWrap(True)
        desc_label.setStyleSheet("color: #666; margin-bottom: 15px;")
        bulk_layout.addWidget(desc_label)

        # File selection
        file_group = QWidget()
        file_layout = QVBoxLayout(file_group)
        file_layout.setSpacing(10)

        file_label = QLabel("TXT File Selection")
        file_label.setStyleSheet("font-weight: bold; font-size: 14px;")
        file_layout.addWidget(file_label)

        file_input_layout = QHBoxLayout()
        self.bulk_file_input = QLineEdit()
        self.bulk_file_input.setPlaceholderText("Select a TXT file containing Spotify URLs...")
        self.bulk_file_input.setText(self.bulk_file_path)
        self.bulk_file_input.setMinimumHeight(35)
        self.bulk_file_input.setReadOnly(True)

        self.bulk_browse_btn = QPushButton("Browse")
        self.bulk_browse_btn.setMinimumHeight(35)
        self.bulk_browse_btn.setFixedWidth(100)
        self.bulk_browse_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.bulk_browse_btn.clicked.connect(self.browse_bulk_file)
        self.bulk_browse_btn.setStyleSheet("""
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 5px;
                font-weight: bold;
                padding: 8px 16px;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """)

        file_input_layout.addWidget(self.bulk_file_input)
        file_input_layout.addWidget(self.bulk_browse_btn)
        file_layout.addLayout(file_input_layout)

        bulk_layout.addWidget(file_group)

        # Progress section
        progress_group = QWidget()
        progress_layout = QVBoxLayout(progress_group)
        progress_layout.setSpacing(8)

        progress_label = QLabel("Progress")
        progress_label.setStyleSheet("font-weight: bold; font-size: 14px;")
        progress_layout.addWidget(progress_label)

        # URL Progress
        url_progress_layout = QHBoxLayout()
        url_progress_layout.addWidget(QLabel("URLs:"))
        self.bulk_url_progress = QLabel("0/0")
        self.bulk_url_progress.setStyleSheet("font-weight: bold;")
        url_progress_layout.addWidget(self.bulk_url_progress)
        url_progress_layout.addStretch()
        progress_layout.addLayout(url_progress_layout)

        # Track Progress  
        track_progress_layout = QHBoxLayout()
        track_progress_layout.addWidget(QLabel("Tracks:"))
        self.bulk_track_progress = QLabel("0/0")
        self.bulk_track_progress.setStyleSheet("font-weight: bold;")
        track_progress_layout.addWidget(self.bulk_track_progress)
        track_progress_layout.addStretch()
        progress_layout.addLayout(track_progress_layout)

        # Progress Bar
        self.bulk_progress_bar = QProgressBar()
        self.bulk_progress_bar.setMinimumHeight(25)
        self.bulk_progress_bar.setVisible(False)
        progress_layout.addWidget(self.bulk_progress_bar)

        # Time info - MODIFICATO CON I NUOVI STILI
        time_layout = QHBoxLayout()
        self.bulk_elapsed_time = QLabel("Elapsed: 00:00:00")
        self.bulk_remaining_time = QLabel("Remaining: --:--:--")
        self.bulk_elapsed_time.setStyleSheet("font-weight: bold; color: #2196F3;")
        self.bulk_remaining_time.setStyleSheet("font-weight: bold; color: #FF9800;")
        time_layout.addWidget(self.bulk_elapsed_time)
        time_layout.addStretch()
        time_layout.addWidget(self.bulk_remaining_time)
        progress_layout.addLayout(time_layout)

        bulk_layout.addWidget(progress_group)

        # Log output
        log_label = QLabel("Activity Log")
        log_label.setStyleSheet("font-weight: bold; font-size: 14px;")
        bulk_layout.addWidget(log_label)

        self.bulk_log_output = QTextEdit()
        self.bulk_log_output.setReadOnly(True)
        self.bulk_log_output.setMaximumHeight(200)
        bulk_layout.addWidget(self.bulk_log_output)

        # Control buttons
        button_layout = QHBoxLayout()
        button_layout.addStretch()

        self.bulk_start_btn = QPushButton("Start Bulk Download")
        self.bulk_start_btn.setMinimumHeight(40)
        self.bulk_start_btn.setFixedWidth(180)
        self.bulk_start_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.bulk_start_btn.clicked.connect(self.start_bulk_download)

        self.bulk_pause_btn = QPushButton("Pause")
        self.bulk_pause_btn.setMinimumHeight(40)
        self.bulk_pause_btn.setFixedWidth(100)
        self.bulk_pause_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.bulk_pause_btn.clicked.connect(self.toggle_bulk_pause)
        self.bulk_pause_btn.setVisible(False)

        self.bulk_stop_btn = QPushButton("Stop")
        self.bulk_stop_btn.setMinimumHeight(40)
        self.bulk_stop_btn.setFixedWidth(100)
        self.bulk_stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.bulk_stop_btn.clicked.connect(self.stop_bulk_download)
        self.bulk_stop_btn.setVisible(False)

        button_style = """
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 5px;
                font-weight: bold;
                padding: 10px 16px;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
            QPushButton:disabled {
                background-color: #1a1a1a;
                color: #666;
            }
        """

        for btn in [self.bulk_start_btn, self.bulk_pause_btn, self.bulk_stop_btn]:
            btn.setStyleSheet(button_style)

        button_layout.addWidget(self.bulk_start_btn)
        button_layout.addWidget(self.bulk_pause_btn)
        button_layout.addWidget(self.bulk_stop_btn)

        bulk_layout.addLayout(button_layout)
        bulk_layout.addStretch()

        bulk_tab.setLayout(bulk_layout)
        self.tab_widget.addTab(bulk_tab, "Bulk Download")

        # Initialize UI state
        self.update_bulk_ui_state()

    def on_track_double_clicked(self, item):
        """Handle double-click on track to start playback"""
        if self.tracks and hasattr(self.media_player, 'tracks'):
            row = self.track_list.row(item)
            self.media_player.current_track_index = row
            self.media_player.was_playing = True  # Set flag to start playing
            self.media_player.load_current_track()

    def setup_info_widget(self):
        self.info_widget = QWidget()
        info_layout = QHBoxLayout()
        self.cover_label = QLabel()
        self.cover_label.setFixedSize(80, 80)
        self.cover_label.setScaledContents(True)
        info_layout.addWidget(self.cover_label)

        text_info_layout = QVBoxLayout()
        
        self.title_label = QLabel()
        self.title_label.setStyleSheet("font-size: 14px; font-weight: bold;")
        self.title_label.setWordWrap(True)
        
        self.artists_label = QLabel()
        self.artists_label.setWordWrap(True)

        self.followers_label = QLabel()
        self.followers_label.setWordWrap(True)
        
        self.release_date_label = QLabel()
        self.release_date_label.setWordWrap(True)
        
        self.type_label = QLabel()
        self.type_label.setStyleSheet("font-size: 12px;")
        
        text_info_layout.addWidget(self.title_label)
        text_info_layout.addWidget(self.artists_label)
        text_info_layout.addWidget(self.followers_label)
        text_info_layout.addWidget(self.release_date_label)
        text_info_layout.addWidget(self.type_label)
        text_info_layout.addStretch()

        info_layout.addLayout(text_info_layout, 1)
        
        # NEW: Add search widget from original
        self.setup_search_widget()
        info_layout.addWidget(self.search_widget)
        
        self.info_widget.setLayout(info_layout)
        self.info_widget.setFixedHeight(100)
        self.info_widget.hide()

    # NEW: Search widget setup from original
    def setup_search_widget(self):
        self.search_widget = QWidget()
        search_layout = QVBoxLayout()
        search_layout.setContentsMargins(10, 0, 0, 0)
        
        search_layout.addStretch()
        
        search_input_layout = QHBoxLayout()
        search_input_layout.addStretch()  
        
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search...")
        self.search_input.setClearButtonEnabled(True)
        self.search_input.textChanged.connect(self.filter_tracks)
        self.search_input.setFixedWidth(250)  
        
        search_input_layout.addWidget(self.search_input)
        search_layout.addLayout(search_input_layout)
        
        self.search_widget.setLayout(search_layout)
        self.search_widget.hide()

    def setup_track_buttons(self):
        self.btn_layout = QHBoxLayout()
        self.download_selected_btn = QPushButton('Download Selected')
        self.download_all_btn = QPushButton('Download All')
        self.remove_btn = QPushButton('Remove Selected')
        self.clear_btn = QPushButton('Clear')
        
        button_style = """
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 5px;
                font-weight: bold;
                padding: 10px 16px;
                min-height: 35px;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """
        
        for btn in [self.download_selected_btn, self.download_all_btn, self.remove_btn, self.clear_btn]:
            btn.setMinimumWidth(150)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setStyleSheet(button_style)
            
        self.download_selected_btn.clicked.connect(self.download_selected)
        self.download_all_btn.clicked.connect(self.download_all)
        self.remove_btn.clicked.connect(self.remove_selected_tracks)
        self.clear_btn.clicked.connect(self.clear_tracks)
        
        self.btn_layout.addStretch()
        for btn in [self.download_selected_btn, self.download_all_btn, self.remove_btn, self.clear_btn]:
            self.btn_layout.addWidget(btn)
        self.btn_layout.addStretch()

    def setup_process_tab(self):
        self.process_tab = QWidget()
        process_layout = QVBoxLayout()
        process_layout.setSpacing(5)
        
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        process_layout.addWidget(self.log_output)
        
        progress_time_layout = QVBoxLayout()
        progress_time_layout.setSpacing(2)
        
        self.progress_bar = QProgressBar()
        self.progress_bar.setMinimumHeight(25)
        progress_time_layout.addWidget(self.progress_bar)
        
        self.time_label = QLabel("00:00:00")
        self.time_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        progress_time_layout.addWidget(self.time_label)
        
        process_layout.addLayout(progress_time_layout)
        
        control_layout = QHBoxLayout()
        self.stop_btn = QPushButton('Stop')
        self.pause_resume_btn = QPushButton('Pause')
        
        control_button_style = """
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 5px;
                font-weight: bold;
                padding: 10px 20px;
                min-height: 35px;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """
        
        self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.pause_resume_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.stop_btn.setStyleSheet(control_button_style)
        self.pause_resume_btn.setStyleSheet(control_button_style)
        
        self.stop_btn.clicked.connect(self.stop_download)
        self.pause_resume_btn.clicked.connect(self.toggle_pause_resume)
        control_layout.addWidget(self.stop_btn)
        control_layout.addWidget(self.pause_resume_btn)
        
        process_layout.addLayout(control_layout)
        
        self.process_tab.setLayout(process_layout)
        
        self.tab_widget.addTab(self.process_tab, "Process")
        
        self.progress_bar.hide()
        self.time_label.hide()
        self.stop_btn.hide()
        self.pause_resume_btn.hide()

    def setup_settings_tab(self):
        settings_tab = QWidget()
        settings_layout = QVBoxLayout()
        settings_layout.setSpacing(10)
        settings_layout.setContentsMargins(9, 9, 9, 9)

        output_group = QWidget()
        output_layout = QVBoxLayout(output_group)
        output_layout.setSpacing(5)
        
        output_label = QLabel('Output Directory')
        output_label.setStyleSheet("font-weight: bold;")
        output_layout.addWidget(output_label)
        
        output_dir_layout = QHBoxLayout()
        self.output_dir = QLineEdit()
        self.output_dir.setText(self.last_output_path)
        self.output_dir.textChanged.connect(self.save_settings)
        self.output_dir.setMinimumHeight(35)
        
        self.output_browse = QPushButton('Browse')
        self.output_browse.setCursor(Qt.CursorShape.PointingHandCursor)
        self.output_browse.clicked.connect(self.browse_output)
        self.output_browse.setMinimumHeight(35)
        self.output_browse.setStyleSheet("""
            QPushButton {
                background-color: #2b2b2b;
                color: white;
                border: 1px solid #555;
                border-radius: 5px;
                font-weight: bold;
                padding: 8px 16px;
            }
            QPushButton:hover {
                background-color: #404040;
            }
            QPushButton:pressed {
                background-color: #1a1a1a;
            }
        """)
        
        output_dir_layout.addWidget(self.output_dir)
        output_dir_layout.addWidget(self.output_browse)
        
        output_layout.addLayout(output_dir_layout)
        
        settings_layout.addWidget(output_group)

        file_group = QWidget()
        file_layout = QVBoxLayout(file_group)
        file_layout.setSpacing(5)
        
        file_label = QLabel('File Settings')
        file_label.setStyleSheet("font-weight: bold;")
        file_layout.addWidget(file_label)
        
        format_layout = QHBoxLayout()
        format_label = QLabel('Filename Format:')
        self.format_group = QButtonGroup(self)
        self.title_artist_radio = QRadioButton('Title - Artist')
        self.title_artist_radio.setCursor(Qt.CursorShape.PointingHandCursor)
        self.title_artist_radio.toggled.connect(self.save_filename_format)
        
        self.artist_title_radio = QRadioButton('Artist - Title')
        self.artist_title_radio.setCursor(Qt.CursorShape.PointingHandCursor)
        self.artist_title_radio.toggled.connect(self.save_filename_format)
        
        self.title_only_radio = QRadioButton('Title')
        self.title_only_radio.setCursor(Qt.CursorShape.PointingHandCursor)
        self.title_only_radio.toggled.connect(self.save_filename_format)
        
        if hasattr(self, 'filename_format') and self.filename_format == "artist_title":
            self.artist_title_radio.setChecked(True)
        elif hasattr(self, 'filename_format') and self.filename_format == "title_only":
            self.title_only_radio.setChecked(True)
        else:
            self.title_artist_radio.setChecked(True)
        
        self.format_group.addButton(self.title_artist_radio)
        self.format_group.addButton(self.artist_title_radio)
        self.format_group.addButton(self.title_only_radio)
        
        format_layout.addWidget(format_label)
        format_layout.addWidget(self.title_artist_radio)
        format_layout.addWidget(self.artist_title_radio)
        format_layout.addWidget(self.title_only_radio)
        format_layout.addStretch()
        file_layout.addLayout(format_layout)

        checkbox_layout = QHBoxLayout()
        
        self.track_number_checkbox = QCheckBox('Add Track Numbers to Album Files')
        self.track_number_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.track_number_checkbox.setChecked(self.use_track_numbers)
        self.track_number_checkbox.toggled.connect(self.save_track_numbering)
        checkbox_layout.addWidget(self.track_number_checkbox)
        
        self.album_subfolder_checkbox = QCheckBox('Create Album Subfolders for Playlist Downloads')
        self.album_subfolder_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.album_subfolder_checkbox.setChecked(self.use_album_subfolders)
        self.album_subfolder_checkbox.toggled.connect(self.save_album_subfolder_setting)
        checkbox_layout.addWidget(self.album_subfolder_checkbox)
        
        checkbox_layout.addStretch()
        file_layout.addLayout(checkbox_layout)
        
        settings_layout.addWidget(file_group)

        auth_group = QWidget()
        auth_layout = QVBoxLayout(auth_group)
        auth_layout.setSpacing(5)
        
        auth_label = QLabel('Service Settings')
        auth_label.setStyleSheet("font-weight: bold;")
        auth_layout.addWidget(auth_label)

        service_fallback_layout = QHBoxLayout()

        service_label = QLabel('Service:')
        
        self.service_dropdown = ServiceComboBox()
        self.service_dropdown.currentIndexChanged.connect(self.on_service_changed)
        service_fallback_layout.addWidget(service_label)
        service_fallback_layout.addWidget(self.service_dropdown)
        
        service_fallback_layout.addSpacing(10)

        region_label = QLabel('Region:')
        self.qobuz_region_dropdown = QobuzRegionComboBox()
        self.qobuz_region_dropdown.currentIndexChanged.connect(self.save_qobuz_region_setting)
        service_fallback_layout.addWidget(region_label)
        service_fallback_layout.addWidget(self.qobuz_region_dropdown)
        
        region_label.hide()
        self.qobuz_region_dropdown.hide()
        
        # NEW: Deezer speed settings
        self.deezer_speed_label = QLabel('Speed:')
        self.deezer_speed_dropdown = QComboBox()
        self.deezer_speed_dropdown.setMinimumHeight(35)
        self.deezer_speed_dropdown.addItem('Fast (5s)', 5)
        self.deezer_speed_dropdown.addItem('Normal (7.5s)', 7.5)
        self.deezer_speed_dropdown.addItem('Slow (10s)', 10)
        self.deezer_speed_dropdown.currentIndexChanged.connect(self.save_deezer_speed_setting)
        service_fallback_layout.addWidget(self.deezer_speed_label)
        service_fallback_layout.addWidget(self.deezer_speed_dropdown)
        
        self.deezer_speed_label.hide()
        self.deezer_speed_dropdown.hide()
        
        service_fallback_layout.addStretch()
        auth_layout.addLayout(service_fallback_layout)
        
        settings_layout.addWidget(auth_group)
        settings_layout.addStretch()
        settings_tab.setLayout(settings_layout)
        self.tab_widget.addTab(settings_tab, "Settings")
        
        for i in range(self.service_dropdown.count()):
            if self.service_dropdown.itemData(i, Qt.ItemDataRole.UserRole + 1) == self.service:
                self.service_dropdown.setCurrentIndex(i)
                break
                
        for i in range(self.qobuz_region_dropdown.count()):
            if self.qobuz_region_dropdown.itemData(i, Qt.ItemDataRole.UserRole + 1) == self.qobuz_region:
                self.qobuz_region_dropdown.setCurrentIndex(i)
                break
        
        # NEW: Set deezer speed dropdown
        for i in range(self.deezer_speed_dropdown.count()):
            if self.deezer_speed_dropdown.itemData(i) == self.deezer_speed:
                self.deezer_speed_dropdown.setCurrentIndex(i)
                break
        
        self.update_service_ui()
        
        self.qobuz_region_dropdown.status_updated.connect(
            lambda region_id, is_online: self.service_dropdown.update_qobuz_status(region_id, is_online)
        )
        
    def setup_about_tab(self):
        about_tab = QWidget()
        about_layout = QVBoxLayout()
        about_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        about_layout.setSpacing(3)

        sections = [
            ("Check for Updates", "https://github.com/afkarxyz/SpotiFLAC/releases"),
            ("Report an Issue", "https://github.com/afkarxyz/SpotiFLAC/issues")
        ]

        for title, url in sections:
            section_widget = QWidget()
            section_layout = QVBoxLayout(section_widget)
            section_layout.setSpacing(10)
            section_layout.setContentsMargins(0, 0, 0, 0)

            label = QLabel(title)
            label.setStyleSheet("color: palette(text); font-weight: bold;")
            label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            section_layout.addWidget(label)

            button = QPushButton("Click Here!")
            button.setFixedWidth(150)
            button.setMinimumHeight(35)
            button.setStyleSheet("""
                QPushButton {
                    background-color: #2b2b2b;
                    color: white;
                    border: 1px solid #555;
                    padding: 8px;
                    border-radius: 15px;
                    font-weight: bold;
                }
                QPushButton:hover {
                    background-color: #404040;
                }
                QPushButton:pressed {
                    background-color: #1a1a1a;
                }
            """)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.clicked.connect(lambda _, url=url: QDesktopServices.openUrl(QUrl(url if url.startswith(('http://', 'https://')) else f'https://{url}')))
            section_layout.addWidget(button, alignment=Qt.AlignmentFlag.AlignCenter)

            about_layout.addWidget(section_widget)
            
            if sections.index((title, url)) < len(sections) - 1:
                spacer = QSpacerItem(20, 6, QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Fixed)
                about_layout.addItem(spacer)

        footer_label = QLabel("v4.0 | July 2025")  # NEW: Updated version
        footer_label.setStyleSheet("font-size: 12px; margin-top: 10px;")
        about_layout.addWidget(footer_label, alignment=Qt.AlignmentFlag.AlignCenter)

        about_tab.setLayout(about_layout)
        self.tab_widget.addTab(about_tab, "About")
    
    # Metodi di gestione del Bulk Download
    def browse_bulk_file(self):
        """Apri dialog per selezionare file TXT"""
        file_path, _ = QFileDialog.getOpenFileName(
            self, 
            "Select TXT File with Spotify URLs", 
            "", 
            "Text Files (*.txt);;All Files (*)"
        )
        
        if file_path:
            self.bulk_file_path = file_path
            self.bulk_file_input.setText(file_path)
            self.settings.setValue('bulk_file_path', file_path)
            self.settings.sync()
            
            # Validate file
            self.validate_bulk_file(file_path)

    def validate_bulk_file(self, file_path):
        """Valida il file TXT e conta gli URL"""
        try:
            with open(file_path, 'r', encoding='utf-8') as file:
                lines = file.readlines()
            
            valid_urls = 0
            for line in lines:
                url = line.strip()
                if url and not url.startswith('#') and 'spotify.com' in url:
                    valid_urls += 1
            
            if valid_urls > 0:
                self.bulk_log_output.append(f"✅ File loaded: {valid_urls} valid Spotify URLs found")
                self.bulk_start_btn.setEnabled(True)
            else:
                self.bulk_log_output.append("❌ No valid Spotify URLs found in file")
                self.bulk_start_btn.setEnabled(False)
                
        except Exception as e:
            self.bulk_log_output.append(f"❌ Error reading file: {str(e)}")
            self.bulk_start_btn.setEnabled(False)

    def start_bulk_download(self):
        """Avvia il bulk download"""
        if not self.bulk_file_path or not os.path.exists(self.bulk_file_path):
            QMessageBox.warning(self, "Warning", "Please select a valid TXT file first.")
            return
        
        output_dir = self.output_dir.text().strip()
        if not output_dir or not os.path.exists(output_dir):
            QMessageBox.warning(self, "Warning", "Please set a valid output directory in Settings.")
            return
        
        # Crea configurazione
        config = BulkConfiguration(
            service=self.service,
            qobuz_region=self.qobuz_region,
            deezer_speed=self.deezer_speed,
            output_directory=output_dir,
            filename_format=self.filename_format,
            use_track_numbers=self.use_track_numbers,
            use_album_subfolders=self.use_album_subfolders,
            retry_404_enabled=True,
            retry_404_max_attempts=10,
            retry_404_delay=3
        )
        
        # Avvia bulk manager
        self.bulk_manager = BulkDownloadManager(self.bulk_file_path, config)
        
        # Connetti i segnali CORRETTI
        self.bulk_manager.bulk_started.connect(self.on_bulk_started)
        self.bulk_manager.bulk_completed.connect(self.on_bulk_completed)
        self.bulk_manager.bulk_progress.connect(self.on_bulk_progress)
        self.bulk_manager.url_processing.connect(self.on_url_processing)
        self.bulk_manager.url_completed.connect(self.on_url_completed)
        self.bulk_manager.track_progress.connect(self.on_track_progress)  # NUOVO
        self.bulk_manager.error_occurred.connect(self.on_bulk_error)
        
        self.bulk_manager.start()
        
        # Setup timer per aggiornamento tempo
        self.bulk_timer = QTimer()
        self.bulk_timer.timeout.connect(self.update_bulk_elapsed_time)
        self.bulk_start_time = datetime.now()
        self.bulk_timer.start(1000)
        
        # Update UI
        self.bulk_start_btn.setEnabled(False)
        self.bulk_pause_btn.setVisible(True)
        self.bulk_stop_btn.setVisible(True)
        self.bulk_progress_bar.setVisible(True)
        self.bulk_log_output.clear()
        self.bulk_log_output.append("🚀 Starting bulk download...")

    def toggle_bulk_pause(self):
        """Toggle pausa/resume bulk download"""
        if not self.bulk_manager:
            return
        
        if hasattr(self.bulk_manager, 'is_paused'):
            if self.bulk_manager.is_paused:
                self.bulk_manager.resume()
                self.bulk_pause_btn.setText("Pause")
                self.bulk_log_output.append("▶️ Bulk download resumed")
                if hasattr(self, 'bulk_timer'):
                    self.bulk_timer.start(1000)
            else:
                self.bulk_manager.pause()
                self.bulk_pause_btn.setText("Resume")
                self.bulk_log_output.append("⏸️ Bulk download paused")
                if hasattr(self, 'bulk_timer'):
                    self.bulk_timer.stop()
        else:
            self.bulk_log_output.append("⚠️ Pause/Resume not supported by this bulk manager")

    def stop_bulk_download(self):
        """Ferma il bulk download"""
        if self.bulk_manager:
            self.bulk_manager.stop()
            self.bulk_log_output.append("⏹️ Bulk download stopped by user")
            if hasattr(self, 'bulk_timer'):
                self.bulk_timer.stop()

    def update_bulk_elapsed_time(self):
        """Aggiorna il tempo trascorso"""
        if hasattr(self, 'bulk_start_time'):
            elapsed = datetime.now() - self.bulk_start_time
            elapsed_str = str(elapsed).split('.')[0]  # Rimuove i microsecondi
            self.bulk_elapsed_time.setText(f"Elapsed: {elapsed_str}")

    def update_bulk_ui_state(self):
        """Aggiorna lo stato della UI bulk"""
        has_file = bool(self.bulk_file_path and os.path.exists(self.bulk_file_path))
        self.bulk_start_btn.setEnabled(has_file)

    # Signal handlers AGGIORNATI per BulkDownloadManager
    def on_bulk_started(self, total_urls):
        """Gestisce l'inizio del bulk download"""
        self.bulk_log_output.append(f"📋 Processing {total_urls} URLs...")
        self.bulk_url_progress.setText(f"0/{total_urls}")
        self.bulk_track_progress.setText("0/0")
        self.bulk_progress_bar.setValue(0)
        self.bulk_progress_bar.setMaximum(100)

    def on_bulk_progress(self, progress_data):
        """Gestisce il progresso del bulk download"""
        try:
            # Aggiorna progress URL
            processed_urls = progress_data.get('processed_urls', 0)
            total_urls = progress_data.get('total_urls', 0)
            self.bulk_url_progress.setText(f"{processed_urls}/{total_urls}")
            
            # Aggiorna progress tracce
            downloaded_tracks = progress_data.get('downloaded_tracks', 0)
            total_tracks = progress_data.get('total_tracks', 0)
            self.bulk_track_progress.setText(f"{downloaded_tracks}/{total_tracks}")
            
            # Aggiorna progress bar principale
            url_percentage = progress_data.get('progress_percentage', 0)
            self.bulk_progress_bar.setValue(int(url_percentage))
            
            # Aggiorna tempo stimato rimanente
            estimated_time = progress_data.get('estimated_time_remaining')
            if estimated_time:
                self.bulk_remaining_time.setText(f"Remaining: {estimated_time}")
            else:
                self.bulk_remaining_time.setText("Remaining: --:--:--")
                
        except Exception as e:
            print(f"Error updating bulk progress: {e}")

    def on_bulk_completed(self, completion_data):
        """Gestisce il completamento del bulk download"""
        try:
            total_urls = completion_data.get('total_urls', 0)
            successful_urls = completion_data.get('successful_urls', 0)
            failed_urls = completion_data.get('failed_urls', 0)
            total_tracks = completion_data.get('total_tracks', 0)
            downloaded_tracks = completion_data.get('downloaded_tracks', 0)
            failed_tracks = completion_data.get('failed_tracks', 0)
            
            self.bulk_log_output.append(f"✅ Bulk download completed!")
            self.bulk_log_output.append(f"📊 URL Results: {successful_urls}/{total_urls} successful, {failed_urls} failed")
            self.bulk_log_output.append(f"🎵 Track Results: {downloaded_tracks}/{total_tracks} downloaded, {failed_tracks} failed")
            
            if hasattr(self, 'bulk_timer'):
                self.bulk_timer.stop()
            
            # Reset UI
            self.bulk_start_btn.setEnabled(True)
            self.bulk_pause_btn.setVisible(False)
            self.bulk_stop_btn.setVisible(False)
            self.bulk_progress_bar.setValue(100)
            self.bulk_remaining_time.setText("Remaining: 00:00:00")
            
        except Exception as e:
            print(f"Error handling bulk completion: {e}")

    def on_url_processing(self, line_number, status, url):
        """Gestisce il processing di un singolo URL"""
        try:
            # Trunca l'URL se troppo lungo
            display_url = url if len(url) <= 50 else url[:47] + "..."
            self.bulk_log_output.append(f"🔄 Line {line_number}: {status}")
            if url:
                self.bulk_log_output.append(f"   📎 {display_url}")
        except Exception as e:
            print(f"Error handling URL processing: {e}")

    def on_url_completed(self, line_number, success, message):
        """Gestisce il completamento di un singolo URL"""
        try:
            icon = "✅" if success else "❌"
            self.bulk_log_output.append(f"{icon} Line {line_number}: {message}")
        except Exception as e:
            print(f"Error handling URL completion: {e}")

    def on_track_progress(self, line_number, track_name, status, completed):
        """NUOVO: Gestisce il progresso delle singole tracce"""
        try:
            if completed:
                icon = "✅"
            elif "Failed" in status:
                icon = "❌"
            elif "404" in status or "retrying" in status.lower():
                icon = "🔄"
            else:
                icon = "⬬"
                
            # Trunca il nome della traccia se troppo lungo
            display_name = track_name if len(track_name) <= 40 else track_name[:37] + "..."
            
            self.bulk_log_output.append(f"   {icon} {display_name}: {status}")
            
            # Auto-scroll al fondo
            self.bulk_log_output.moveCursor(self.bulk_log_output.textCursor().End)
            
        except Exception as e:
            print(f"Error handling track progress: {e}")

    def on_bulk_error(self, error_message):
        """Gestisce errori del bulk download"""
        try:
            self.bulk_log_output.append(f"❌ Error: {error_message}")
            QMessageBox.critical(self, "Bulk Download Error", str(error_message))
            
            if hasattr(self, 'bulk_timer'):
                self.bulk_timer.stop()
            
            # Reset UI
            self.bulk_start_btn.setEnabled(True)
            self.bulk_pause_btn.setVisible(False)
            self.bulk_stop_btn.setVisible(False)
            self.bulk_progress_bar.setVisible(False)
            
        except Exception as e:
            print(f"Error handling bulk error: {e}")
    
    def on_service_changed(self, index):
        service = self.service_dropdown.currentData()
        self.service = service
        self.settings.setValue('service', service)
        self.settings.sync()
        
        # Update media player service settings
        if hasattr(self, 'media_player'):
            self.media_player.set_service_settings(service, self.qobuz_region, self.deezer_speed)
        
        self.update_service_ui()
        self.log_output.append(f"Service changed to: {self.service_dropdown.currentText()}")

    def update_service_ui(self):
        service = self.service
        
        region_label = None
        for widget in self.qobuz_region_dropdown.parentWidget().children():
            if isinstance(widget, QLabel) and widget.text() == "Region:":
                region_label = widget
                break

        if service == "qobuz":
            if region_label:
                region_label.show()
            self.qobuz_region_dropdown.show()
            self.deezer_speed_label.hide()
            self.deezer_speed_dropdown.hide()
        elif service == "deezer":  # NEW: Show deezer speed for deezer
            if region_label:
                region_label.hide()
            self.qobuz_region_dropdown.hide()
            self.deezer_speed_label.show()
            self.deezer_speed_dropdown.show()
        else:
            if region_label:
                region_label.hide()
            self.qobuz_region_dropdown.hide()
            self.deezer_speed_label.hide()
            self.deezer_speed_dropdown.hide()

    def save_url(self):
        self.settings.setValue('spotify_url', self.spotify_url.text().strip())
        self.settings.sync()
        
    def save_filename_format(self):
        if self.artist_title_radio.isChecked():
            self.filename_format = "artist_title"
        elif self.title_only_radio.isChecked():
            self.filename_format = "title_only"
        else:
            self.filename_format = "title_artist"
        self.settings.setValue('filename_format', self.filename_format)
        self.settings.sync()
        
    def save_track_numbering(self):
        self.use_track_numbers = self.track_number_checkbox.isChecked()
        self.settings.setValue('use_track_numbers', self.use_track_numbers)
        self.settings.sync()

    def save_album_subfolder_setting(self):
        self.use_album_subfolders = self.album_subfolder_checkbox.isChecked()
        self.settings.setValue('use_album_subfolders', self.use_album_subfolders)
        self.settings.sync()
    
    def save_qobuz_region_setting(self):
        region = self.qobuz_region_dropdown.currentData()
        self.qobuz_region = region
        self.settings.setValue('qobuz_region', region)
        self.settings.sync()
        
        # Update media player service settings
        if hasattr(self, 'media_player'):
            self.media_player.set_service_settings(self.service, region, self.deezer_speed)
            
        self.log_output.append(f"Qobuz region setting saved: {self.qobuz_region_dropdown.currentText()}")
    
    # NEW: Save deezer speed setting
    def save_deezer_speed_setting(self):
        speed = self.deezer_speed_dropdown.currentData()
        self.deezer_speed = speed
        self.settings.setValue('deezer_speed', speed)
        self.settings.sync()
        
        # Update media player service settings
        if hasattr(self, 'media_player'):
            self.media_player.set_service_settings(self.service, self.qobuz_region, speed)
            
        self.log_output.append(f"Deezer speed setting saved: {self.deezer_speed_dropdown.currentText()}")
    
    def save_settings(self):
        self.settings.setValue('output_path', self.output_dir.text().strip())
        self.settings.sync()
        self.log_output.append("Settings saved successfully!")

    def update_timer(self):
        self.elapsed_time = self.elapsed_time.addSecs(1)
        self.time_label.setText(self.elapsed_time.toString("hh:mm:ss"))
                        
    def fetch_tracks(self):
        url = self.spotify_url.text().strip()
        
        if not url:
            self.log_output.append('Warning: Please enter a Spotify URL.')
            return

        try:
            self.reset_state()
            self.reset_ui()
            
            self.log_output.append('Just a moment. Fetching metadata...')
            self.tab_widget.setCurrentWidget(self.process_tab)
            
            self.metadata_worker = MetadataFetchWorker(url)
            self.metadata_worker.finished.connect(self.on_metadata_fetched)
            self.metadata_worker.error.connect(self.on_metadata_error)
            self.metadata_worker.start()
            
        except Exception as e:
            self.log_output.append(f'Error: Failed to start metadata fetch: {str(e)}')
    
    def on_metadata_fetched(self, metadata):
        try:
            url_info = parse_uri(self.spotify_url.text().strip())
            
            if url_info["type"] == "track":
                self.handle_track_metadata(metadata["track"])
            elif url_info["type"] == "album":
                self.handle_album_metadata(metadata)
            elif url_info["type"] == "playlist":
                self.handle_playlist_metadata(metadata)
                
            self.update_button_states()
            self.tab_widget.setCurrentIndex(0)
        except Exception as e:
            self.log_output.append(f'Error: {str(e)}')
    
    def on_metadata_error(self, error_message):
        self.log_output.append(f'Error: {error_message}')

    def handle_track_metadata(self, track_data):
        self.tracks = []
        track_id = track_data["external_urls"].split("/")[-1]
        
        self.tracks.append(Track(
            external_urls=track_data["external_urls"],
            title=track_data["name"],
            artists=track_data["artists"],
            album=track_data["album"]["name"],
            track_number=track_data["track_number"],
            duration_ms=track_data.get("duration_ms", 0),
            id=track_id,
            isrc=track_data.get("isrc", ""),
            preview_url=track_data.get("preview_url", "")
        ))
        
        self.all_tracks = self.tracks.copy()
        self.is_single_track = True
        self.is_album = self.is_playlist = False
        
        metadata = {
            'title': track_data["name"],
            'artists': track_data["artists"],
            'releaseDate': track_data["album"]["release_date"],
            'cover': track_data["album"]["images"],
            'duration_ms': track_data.get("duration_ms", 0)
        }
        self.update_display_after_fetch(metadata)

    def handle_album_metadata(self, album_data):
        self.album_or_playlist_name = album_data["album_info"]["name"]
        self.tracks = []
        
        for track in album_data["track_list"]:
            track_id = track["external_urls"].split("/")[-1]
            
            self.tracks.append(Track(
                external_urls=track["external_urls"],
                title=track["name"],
                artists=track["artists"],
                album=self.album_or_playlist_name,
                track_number=track["track_number"],
                duration_ms=track.get("duration_ms", 0),
                id=track_id,
                isrc=track.get("isrc", ""),
                preview_url=track.get("preview_url", "")
            ))
            
        self.all_tracks = self.tracks.copy()
        self.is_album = True
        self.is_playlist = self.is_single_track = False
        
        metadata = {
            'title': album_data["album_info"]["name"],
            'artists': album_data["album_info"]["artists"],
            'releaseDate': album_data["album_info"]["release_date"],
            'cover': album_data["album_info"]["images"],
            'total_tracks': album_data["album_info"]["total_tracks"]
        }
        self.update_display_after_fetch(metadata)

    def handle_playlist_metadata(self, playlist_data):
        self.album_or_playlist_name = playlist_data["playlist_info"]["owner"]["name"]
        self.tracks = []
        
        for track in playlist_data["track_list"]:
            track_id = track["external_urls"].split("/")[-1]
            
            self.tracks.append(Track(
                external_urls=track["external_urls"],
                title=track["name"],
                artists=track["artists"],
                album=track.get("album_name", ""),
                track_number=len(self.tracks) + 1,
                duration_ms=track.get("duration_ms", 0),
                id=track_id,
                isrc=track.get("isrc", ""),
                preview_url=track.get("preview_url", "")
            ))
            
        self.all_tracks = self.tracks.copy()
        self.is_playlist = True
        self.is_album = self.is_single_track = False
        
        metadata = {
            'title': playlist_data["playlist_info"]["owner"]["name"],
            'artists': playlist_data["playlist_info"]["owner"]["display_name"],
            'cover': playlist_data["playlist_info"]["owner"]["images"],
            'followers': playlist_data["playlist_info"]["followers"]["total"],
            'total_tracks': playlist_data["playlist_info"]["tracks"]["total"]
        }
        self.update_display_after_fetch(metadata)

    def update_display_after_fetch(self, metadata):
        self.track_list.setVisible(not self.is_single_track)
        
        if not self.is_single_track:
            self.search_widget.show()
            self.update_track_list_display()
        else:
            self.search_widget.hide()
        
        # Load tracks into media player if we have tracks
        if self.tracks:
            self.media_player.set_service_settings(self.service, self.qobuz_region, self.deezer_speed)
            self.media_player.load_tracks(self.tracks)
        
        self.update_info_widget(metadata)
            
    def update_info_widget(self, metadata):
        self.title_label.setText(metadata['title'])
        
        if self.is_single_track or self.is_album:
            artists = metadata['artists'] if isinstance(metadata['artists'], list) else metadata['artists'].split(", ")
            label_text = "Artists" if len(artists) > 1 else "Artist"
            artists_text = ", ".join(artists)
            self.artists_label.setText(f"<b>{label_text}</b> {artists_text}")
        else:
            self.artists_label.setText(f"<b>Owner</b> {metadata['artists']}")
        
        if self.is_playlist and 'followers' in metadata:
            self.followers_label.setText(f"<b>Followers</b> {metadata['followers']:,}")
            self.followers_label.show()
        else:
            self.followers_label.hide()
        
        if metadata.get('releaseDate'):
            try:
                release_date = metadata['releaseDate']
                if len(release_date) == 4:
                    date_obj = datetime.strptime(release_date, "%Y")
                elif len(release_date) == 7:
                    date_obj = datetime.strptime(release_date, "%Y-%m")
                else:
                    date_obj = datetime.strptime(release_date, "%Y-%m-%d")
                
                formatted_date = date_obj.strftime("%d-%m-%Y")
                self.release_date_label.setText(f"<b>Released</b> {formatted_date}")
                self.release_date_label.show()
            except ValueError:
                self.release_date_label.setText(f"<b>Released</b> {metadata['releaseDate']}")
                self.release_date_label.show()
        else:
            self.release_date_label.hide()
        
        if self.is_single_track:
            duration = self.format_duration(metadata.get('duration_ms', 0))
            self.type_label.setText(f"<b>Duration</b> {duration}")
        elif self.is_album:
            total_tracks = metadata.get('total_tracks', 0)
            self.type_label.setText(f"<b>Album</b> • {total_tracks} tracks")
        elif self.is_playlist:
            total_tracks = metadata.get('total_tracks', 0)
            self.type_label.setText(f"<b>Playlist</b> • {total_tracks} tracks")
        
        if metadata.get('cover'):
            self.network_manager.get(QNetworkRequest(QUrl(metadata['cover'])))
        
        self.info_widget.show()

    def reset_info_widget(self):
        self.title_label.clear()
        self.artists_label.clear()
        self.followers_label.clear()
        self.release_date_label.clear()
        self.type_label.clear()
        self.cover_label.clear()
        self.info_widget.hide()

    def on_cover_loaded(self, reply):
        if reply.error() == QNetworkReply.NetworkError.NoError:
            data = reply.readAll()
            pixmap = QPixmap()
            pixmap.loadFromData(data)
            self.cover_label.setPixmap(pixmap)

    def update_button_states(self):
        if self.is_single_track:
            self.download_selected_btn.hide()
            self.remove_btn.hide()
            self.download_all_btn.setText('Download')
            self.clear_btn.setText('Clear')
        else:
            self.download_selected_btn.show()
            self.remove_btn.show()
            self.download_all_btn.setText('Download All')
            self.clear_btn.setText('Clear')
        
        self.download_all_btn.show()
        self.clear_btn.show()
        
        self.download_selected_btn.setEnabled(True)
        self.download_all_btn.setEnabled(True)

    def hide_track_buttons(self):
        buttons = [
            self.download_selected_btn,
            self.download_all_btn,
            self.remove_btn,
            self.clear_btn
        ]
        for btn in buttons:
            btn.hide()

    def download_selected(self):
        if self.is_single_track:
            self.download_all()
        else:
            selected_items = self.track_list.selectedItems()
            if not selected_items:
                self.log_output.append('Warning: Please select tracks to download.')
                return
            self.download_tracks([self.track_list.row(item) for item in selected_items])

    def download_all(self):
        if self.is_single_track:
            self.download_tracks([0])
        else:
            self.download_tracks(range(self.track_list.count()))

    def download_tracks(self, indices):
        self.log_output.clear()
        raw_outpath = self.output_dir.text().strip()
        outpath = os.path.normpath(raw_outpath)
        if not os.path.exists(outpath):
            self.log_output.append('Warning: Invalid output directory.')
            return

        tracks_to_download = self.tracks if self.is_single_track else [self.tracks[i] for i in indices]

        if self.is_album or self.is_playlist:
            name = self.album_or_playlist_name.strip()
            folder_name = re.sub(r'[<>:"/\\|?*]', '_', name)
            outpath = os.path.join(outpath, folder_name)
            os.makedirs(outpath, exist_ok=True)

        try:
            self.start_download_worker(tracks_to_download, outpath)
        except Exception as e:
            self.log_output.append(f"Error: An error occurred while starting the download: {str(e)}")

    def start_download_worker(self, tracks_to_download, outpath):
        service = self.service_dropdown.currentData()
        qobuz_region = self.qobuz_region_dropdown.currentData() if service == "qobuz" else "us"
        deezer_speed = self.deezer_speed_dropdown.currentData() if service == "deezer" else 7.5
        
        # Pass cache directory to download worker
        cache_dir = self.media_player.cache_dir if hasattr(self.media_player, 'cache_dir') else None
    
        self.worker = DownloadWorker(
            tracks_to_download, 
            outpath,
            self.is_single_track, 
            self.is_album, 
            self.is_playlist, 
            self.album_or_playlist_name,
            self.filename_format,
            self.use_track_numbers,
            self.use_album_subfolders,
            service,
            qobuz_region,
            deezer_speed,
            cache_dir
        )
        self.worker.finished.connect(self.on_download_finished)
        self.worker.progress.connect(self.update_progress)
        self.worker.start()
        self.start_timer()
        self.update_ui_for_download_start()

    def update_ui_for_download_start(self):
        self.download_selected_btn.setEnabled(False)
        self.download_all_btn.setEnabled(False)
        self.stop_btn.show()
        self.pause_resume_btn.show()
        self.progress_bar.show()
        self.progress_bar.setValue(0)
        
        self.tab_widget.setCurrentWidget(self.process_tab)

    def update_progress(self, message, percentage):
        if "Download progress:" in message or "Processing metadata..." in message:
            current_text = self.log_output.toPlainText()
            
            if current_text:
                lines = current_text.split('\n')
                
                if "Download progress:" in lines[-1] or "Processing metadata..." in lines[-1]:
                    lines[-1] = message
                    
                    new_text = '\n'.join(lines)
                    
                    self.log_output.setPlainText(new_text)
                    
                    self.log_output.moveCursor(QTextCursor.MoveOperation.End)
                else:
                    self.log_output.append(message)
            else:
                self.log_output.append(message)
        else:
            self.log_output.append(message)
        
        if percentage > 0 and not "Download progress:" in message:
            self.progress_bar.setValue(percentage)

    def stop_download(self):
        if hasattr(self, 'worker'):
            self.worker.stop()
        self.stop_timer()
        self.on_download_finished(True, "Download stopped by user.", [])
        
    def on_download_finished(self, success, message, failed_tracks):
        self.progress_bar.hide()
        self.stop_btn.hide()
        self.pause_resume_btn.hide()
        self.pause_resume_btn.setText('Pause')
        self.stop_timer()
        
        self.download_selected_btn.setEnabled(True)
        self.download_all_btn.setEnabled(True)
        
        if success:
            self.log_output.append(f"\nStatus: {message}")
            if failed_tracks:
                self.log_output.append("\nFailed downloads:")
                for title, artists, error in failed_tracks:
                    self.log_output.append(f"• {title} - {artists}")
                    self.log_output.append(f"  Error: {error}\n")
        else:
            self.log_output.append(f"Error: {message}")

        self.tab_widget.setCurrentWidget(self.process_tab)
    
    def toggle_pause_resume(self):
        if hasattr(self, 'worker'):
            if self.worker.is_paused:
                self.worker.resume()
                self.pause_resume_btn.setText('Pause')
                self.timer.start(1000)
            else:
                self.worker.pause()
                self.pause_resume_btn.setText('Resume')

    def remove_selected_tracks(self):
        if not self.is_single_track:
            selected_items = self.track_list.selectedItems()
            selected_indices = [self.track_list.row(item) for item in selected_items]
            
            tracks_to_remove = [self.tracks[i] for i in selected_indices]
            
            for track in tracks_to_remove:
                if track in self.tracks:
                    self.tracks.remove(track)
                if track in self.all_tracks:
                    self.all_tracks.remove(track)
            
            # Update media player with new track list
            if self.tracks:
                self.media_player.load_tracks(self.tracks)
            else:
                self.media_player.hide()
            
            if self.is_playlist:
                for i, track in enumerate(self.all_tracks, 1):
                    track.track_number = i
            
            self.update_track_list_display()

    def clear_tracks(self):
        self.reset_state()
        self.reset_ui()
        self.tab_widget.setCurrentIndex(0) 

    def start_timer(self):
        self.elapsed_time = QTime(0, 0, 0)
        self.time_label.setText("00:00:00")
        self.time_label.show()
        self.timer.start(1000)
    
    def stop_timer(self):
        self.timer.stop()
        self.time_label.hide()

if __name__ == '__main__':
    try:
        if sys.platform == "win32":
            import io
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception as e:
        pass
        
    app = QApplication(sys.argv)
    ex = SpotiFLACGUI()
    ex.show()
    sys.exit(app.exec())