import sys
import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
import requests
import re
import asyncio
import json
from packaging import version
import qdarktheme
from mutagen.flac import FLAC

from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLineEdit,
    QLabel, QFileDialog, QListWidget, QTextEdit, QTabWidget, QButtonGroup, QRadioButton,
    QAbstractItemView, QProgressBar, QCheckBox, QDialog,
    QDialogButtonBox, QComboBox, QStyledItemDelegate, QMessageBox
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QUrl, QTimer, QTime, QSettings, QSize
from PyQt6.QtGui import QIcon, QTextCursor, QDesktopServices, QPixmap, QBrush, QPainter, QColor
from PyQt6.QtSvg import QSvgRenderer
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply

from getMetadata import get_filtered_data, parse_uri, SpotifyInvalidUrlException
from tidalDL import TidalDownloader
from deezerDL import DeezerDownloader
from getSecret import scrape_and_save

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
    release_date: str = ""

class SecretScrapeWorker(QThread):
    finished = pyqtSignal(bool, str)
    progress = pyqtSignal(str)
    
    def run(self):
        try:
            self.progress.emit("Fixing error...")
            self.progress.emit("Please wait, this may take a moment...")
            
            success, message = scrape_and_save(progress_callback=self.progress.emit)
            
            if success:
                self.finished.emit(True, "Fixed successfully!")
            else:
                self.finished.emit(False, message)
                
        except Exception as e:
            self.finished.emit(False, f"Error: {str(e)}")

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
    finished = pyqtSignal(bool, str, list, list, list)
    progress = pyqtSignal(str, int)
    
    def __init__(self, tracks, outpath, is_single_track=False, is_album=False, is_playlist=False,
                 album_or_playlist_name='', filename_format='title_artist', use_track_numbers=True,
                 use_artist_subfolders=False, use_album_subfolders=False, service="tidal", tidal_api_url=None):
        super().__init__()
        self.tracks = tracks
        self.outpath = outpath
        self.is_single_track = is_single_track
        self.is_album = is_album        
        self.is_playlist = is_playlist
        self.album_or_playlist_name = album_or_playlist_name
        self.filename_format = filename_format
        self.use_track_numbers = use_track_numbers
        self.use_artist_subfolders = use_artist_subfolders
        self.use_album_subfolders = use_album_subfolders
        self.service = service
        self.tidal_api_url = tidal_api_url
        self.is_paused = False
        self.is_stopped = False
        self.failed_tracks = []
        self.successful_tracks = []
        self.skipped_tracks = []

    def get_flac_isrc(self, filepath):
        try:
            audio = FLAC(filepath)
            if 'isrc' in audio:
                return audio['isrc'][0]
        except Exception:
            pass
        return None

    def get_formatted_filename(self, track):
        if self.filename_format == "artist_title":
            filename = f"{track.artists} - {track.title}.flac"
        elif self.filename_format == "title_only":
            filename = f"{track.title}.flac"
        else:
            filename = f"{track.title} - {track.artists}.flac"
        return re.sub(r'[<>:"/\\|?*]', lambda m: "'" if m.group() == '"' else '_', filename)

    def run(self):
        try:
            if self.service == "tidal": 
                downloader = TidalDownloader(api_url=self.tidal_api_url)            
            elif self.service == "deezer":
                downloader = DeezerDownloader()
            else:
                downloader = TidalDownloader(api_url=self.tidal_api_url)
            
            def progress_update(current, total):
                if total <= 0:
                    self.progress.emit("Processing metadata...", 0)
            
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
                    if self.is_playlist:
                        track_outpath = self.outpath
                        
                        if self.use_artist_subfolders:
                            artist_name = track.artists.split(', ')[0] if ', ' in track.artists else track.artists
                            artist_folder = re.sub(r'[<>:"/\\|?*]', lambda m: "'" if m.group() == '"' else '_', artist_name)
                            track_outpath = os.path.join(track_outpath, artist_folder)
                        
                        if self.use_album_subfolders:
                            album_folder = re.sub(r'[<>:"/\\|?*]', lambda m: "'" if m.group() == '"' else '_', track.album)
                            track_outpath = os.path.join(track_outpath, album_folder)
                        
                        os.makedirs(track_outpath, exist_ok=True)
                    else:
                        track_outpath = self.outpath
                    
                    spotify_isrc = track.isrc
                    if spotify_isrc:
                        is_already_downloaded = False
                        try:
                            for filename in os.listdir(track_outpath):
                                if filename.lower().endswith('.flac'):
                                    filepath = os.path.join(track_outpath, filename)
                                    local_isrc = self.get_flac_isrc(filepath)
                                    if local_isrc and local_isrc == spotify_isrc:
                                        self.progress.emit(f"Skipped: Track with matching ISRC '{spotify_isrc}' already exists ('{filename}').", 0)
                                        self.progress.emit(f"Skipped: {track.title} - {track.artists}",
                                                        int((i + 1) / total_tracks * 100))
                                        self.skipped_tracks.append(track)
                                        is_already_downloaded = True
                                        break
                        except FileNotFoundError:
                            pass
                        
                        if is_already_downloaded:
                            continue
                    
                    if (self.is_album or self.is_playlist) and self.use_track_numbers:
                        new_filename = f"{track.track_number:02d} - {self.get_formatted_filename(track)}"
                    else:
                        new_filename = self.get_formatted_filename(track)
                    
                    new_filename = re.sub(r'[<>:"/\\|?*]', lambda m: "'" if m.group() == '"' else '_', new_filename)
                    new_filepath = os.path.join(track_outpath, new_filename)
                    
                    if os.path.exists(new_filepath) and os.path.getsize(new_filepath) > 0:
                        self.progress.emit(f"File already exists by name: {new_filename}. Skipping download.", 0)
                        self.progress.emit(f"Skipped: {track.title} - {track.artists}", 
                                    int((i + 1) / total_tracks * 100))
                        self.skipped_tracks.append(track)
                        continue
                    
                    if self.service == "tidal": 
                        if not track.isrc:
                            self.progress.emit(f"No ISRC found for track: {track.title}. Skipping.", 0)
                            self.failed_tracks.append((track.title, track.artists, "No ISRC available"))
                            continue
                        
                        self.progress.emit(f"Searching and downloading from Tidal for ISRC: {track.isrc} - {track.title} - {track.artists}", 0)
                        is_paused_callback = lambda: self.is_paused
                        is_stopped_callback = lambda: self.is_stopped
                        
                        download_result_details = downloader.download(
                            query=f"{track.title} {track.artists}", 
                            isrc=track.isrc,
                            output_dir=track_outpath,
                            quality="LOSSLESS", 
                            is_paused_callback=is_paused_callback,
                            is_stopped_callback=is_stopped_callback
                        )
                        
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
                            self.skipped_tracks.append(track)
                        else: 
                            downloaded_file = None 
                            raise Exception(f"Tidal download failed or returned unexpected result: {download_result_details}")
                    elif self.service == "deezer":
                        if not track.isrc:
                            self.progress.emit(f"No ISRC found for track: {track.title}. Skipping.", 0)
                            self.failed_tracks.append((track.title, track.artists, "No ISRC available"))
                            continue
                        
                        self.progress.emit(f"Downloading from Deezer with ISRC: {track.isrc}", 0)
                        
                        success = asyncio.run(downloader.download_by_isrc(track.isrc, track_outpath))
                        
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

                    if downloaded_file and os.path.exists(downloaded_file):
                        if downloaded_file == new_filepath:
                            self.progress.emit(f"File already exists: {new_filename}", 0)
                            self.progress.emit(f"Skipped: {track.title} - {track.artists}", 
                                        int((i + 1) / total_tracks * 100))
                            self.skipped_tracks.append(track)
                            continue
                        
                        if downloaded_file != new_filepath:
                            try:
                                os.rename(downloaded_file, new_filepath)
                                self.progress.emit(f"File renamed to: {new_filename}", 0)
                            except OSError as e:
                                self.progress.emit(f"Warning: Could not rename file {downloaded_file} to {new_filepath}: {str(e)}", 0)
                                pass
                    else:
                        raise Exception(f"Download failed or file not found: {downloaded_file}")
                    
                    self.progress.emit(f"Successfully downloaded: {track.title} - {track.artists}", 
                                    int((i + 1) / total_tracks * 100))
                    self.successful_tracks.append(track)
                except Exception as e:
                    self.failed_tracks.append((track.title, track.artists, str(e)))
                    self.progress.emit(f"Failed to download: {track.title} - {track.artists}\nError: {str(e)}", 
                                    int((i + 1) / total_tracks * 100))
                    continue

            if not self.is_stopped:
                success_message = "Download completed!"
                if self.failed_tracks:
                    success_message += f"\n\nFailed downloads: {len(self.failed_tracks)} tracks"
                if self.successful_tracks:
                    success_message += f"\n\nSuccessful downloads: {len(self.successful_tracks)} tracks"
                if self.skipped_tracks:
                    success_message += f"\n\nSkipped (already exists): {len(self.skipped_tracks)} tracks"
                self.finished.emit(True, success_message, self.failed_tracks, self.successful_tracks, self.skipped_tracks)
                
        except Exception as e:
            self.finished.emit(False, str(e), self.failed_tracks, self.successful_tracks, self.skipped_tracks)

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
        self.setWindowTitle("Update Now")
        self.setFixedWidth(400)
        self.setModal(True)

        layout = QVBoxLayout()

        message = QLabel(f"SpotiFLAC v{new_version} Available!")
        message.setWordWrap(True)
        layout.addWidget(message)

        button_box = QDialogButtonBox()
        self.update_button = QPushButton("Check")
        self.update_button.setCursor(Qt.CursorShape.PointingHandCursor)
        self.cancel_button = QPushButton("Later")
        self.cancel_button.setCursor(Qt.CursorShape.PointingHandCursor)
        
        button_box.addButton(self.update_button, QDialogButtonBox.ButtonRole.AcceptRole)
        button_box.addButton(self.cancel_button, QDialogButtonBox.ButtonRole.RejectRole)
        
        layout.addWidget(button_box)

        self.setLayout(layout)

        self.update_button.clicked.connect(self.accept)
        self.cancel_button.clicked.connect(self.reject)

class ServiceStatusDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        item_data = index.data(Qt.ItemDataRole.UserRole)
        is_online = item_data.get('online', False) if item_data else False
        
        super().paint(painter, option, index)
        
        indicator_color = Qt.GlobalColor.green if is_online else Qt.GlobalColor.red
        
        circle_size = 6
        circle_y = option.rect.center().y() - circle_size // 2
        circle_x = option.rect.right() - circle_size - 5
        
        painter.save()
        painter.setPen(Qt.PenStyle.NoPen)
        painter.setBrush(QBrush(indicator_color))
        painter.drawEllipse(circle_x, circle_y, circle_size, circle_size)
        painter.restore()

class TidalAPIDelegate(QStyledItemDelegate):
    def paint(self, painter, option, index):
        item_data = index.data(Qt.ItemDataRole.UserRole)
        
        super().paint(painter, option, index)
        
        if item_data and isinstance(item_data, dict) and 'status' in item_data:
            is_online = item_data.get('status') == 'UP'
            indicator_color = Qt.GlobalColor.green if is_online else Qt.GlobalColor.red
            
            circle_size = 6
            circle_y = option.rect.center().y() - circle_size // 2
            circle_x = option.rect.right() - circle_size - 5
            
            painter.save()
            painter.setPen(Qt.PenStyle.NoPen)
            painter.setBrush(QBrush(indicator_color))
            painter.drawEllipse(circle_x, circle_y, circle_size, circle_size)
            painter.restore()

class TidalStatusChecker(QThread):
    status_updated = pyqtSignal(bool)
    error = pyqtSignal(str)

    def run(self):
        try:
            response = requests.get("https://status.monochrome.tf", timeout=5)
            is_online = response.status_code == 200
            self.status_updated.emit(is_online)
        except Exception as e:
            self.error.emit(f"Error checking Tidal status: {str(e)}")
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

class ServiceComboBox(QComboBox):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setIconSize(QSize(16, 16))
        self.setItemDelegate(ServiceStatusDelegate())
        self.setup_items()
        
        self.tidal_status_checker = TidalStatusChecker()
        self.tidal_status_checker.status_updated.connect(self.update_tidal_status)
        self.tidal_status_checker.error.connect(lambda e: print(f"Tidal status check error: {e}"))
        self.tidal_status_checker.start()

        self.tidal_status_timer = QTimer(self)
        self.tidal_status_timer.timeout.connect(self.refresh_tidal_status)
        self.tidal_status_timer.start(60000)
        
        self.deezer_status_checker = DeezerStatusChecker()
        self.deezer_status_checker.status_updated.connect(self.update_deezer_status)
        self.deezer_status_checker.error.connect(lambda e: print(f"Deezer status check error: {e}"))
        self.deezer_status_checker.start()

        self.deezer_status_timer = QTimer(self)
        self.deezer_status_timer.timeout.connect(self.refresh_deezer_status)
        self.deezer_status_timer.start(60000)  
        
    def setup_items(self):
        current_dir = os.path.dirname(os.path.abspath(__file__))
        
        self.services = [
            {'id': 'tidal', 'name': 'Tidal', 'icon': 'icons/tidal.png', 'online': False},
            {'id': 'deezer', 'name': 'Deezer', 'icon': 'icons/deezer.png', 'online': False}
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
    
    def update_tidal_status(self, is_online):
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
        if hasattr(self, 'tidal_status_checker') and self.tidal_status_checker.isRunning():
            self.tidal_status_checker.quit()
            self.tidal_status_checker.wait()
        
        self.tidal_status_checker = TidalStatusChecker()
        self.tidal_status_checker.status_updated.connect(self.update_tidal_status)
        self.tidal_status_checker.error.connect(lambda e: print(f"Tidal status check error: {e}"))
        self.tidal_status_checker.start()
    
    def update_deezer_status(self, is_online):
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
        if hasattr(self, 'deezer_status_checker') and self.deezer_status_checker.isRunning():
            self.deezer_status_checker.quit()
            self.deezer_status_checker.wait()
        
        self.deezer_status_checker = DeezerStatusChecker()
        self.deezer_status_checker.status_updated.connect(self.update_deezer_status)
        self.deezer_status_checker.error.connect(lambda e: print(f"Deezer status check error: {e}"))
        self.deezer_status_checker.start()
        
    def currentData(self, role=Qt.ItemDataRole.UserRole + 1):
        return super().currentData(role)

class SpotiFLACGUI(QWidget):
    def __init__(self):
        super().__init__()
        self.current_version = "5.1"
        self.tracks = []
        self.all_tracks = []  
        self.successful_downloads = []
        self.reset_state()
        
        self.settings = QSettings('SpotiFLAC', 'Settings')
        self.last_output_path = self.settings.value('output_path', str(Path.home() / "Music"))
        self.last_url = self.settings.value('spotify_url', '')
        
        self.filename_format = self.settings.value('filename_format', 'title_artist')
        self.use_track_numbers = self.settings.value('use_track_numbers', False, type=bool)
        self.use_artist_subfolders = self.settings.value('use_artist_subfolders', False, type=bool)
        self.use_album_subfolders = self.settings.value('use_album_subfolders', False, type=bool)
        self.service = self.settings.value('service', 'tidal')
        self.tidal_api = self.settings.value('tidal_api', 'https://hifi.401658.xyz')
        self.check_for_updates = self.settings.value('check_for_updates', True, type=bool)
        self.current_theme_color = self.settings.value('theme_color', '#2196F3')
        self.track_list_format = self.settings.value('track_list_format', 'track_artist_date_duration')
        self.date_format = self.settings.value('date_format', 'dd_mm_yyyy')
        
        self.elapsed_time = QTime(0, 0, 0)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_timer)
        
        self.network_manager = QNetworkAccessManager()
        self.network_manager.finished.connect(self.on_cover_loaded)
        
        self.initUI()
        
        if self.check_for_updates:
            QTimer.singleShot(0, self.check_updates)

    def set_combobox_value(self, combobox, target_value):
        for i in range(combobox.count()):
            if combobox.itemData(i, Qt.ItemDataRole.UserRole + 1) == target_value:
                combobox.setCurrentIndex(i)
                return True
            if combobox.itemData(i, Qt.ItemDataRole.UserRole) == target_value:
                combobox.setCurrentIndex(i)
                return True
        return False

    def check_updates(self):
        try:
            response = requests.get("https://raw.githubusercontent.com/afkarxyz/SpotiFLAC/refs/heads/main/version.json")
            if response.status_code == 200:
                data = response.json()
                new_version = data.get("version")
                
                if new_version and version.parse(new_version) > version.parse(self.current_version):
                    dialog = UpdateDialog(self.current_version, new_version, self)
                    result = dialog.exec()
                    
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
        self.all_tracks.clear()
        self.is_album = False
        self.is_playlist = False 
        self.is_single_track = False
        self.album_or_playlist_name = ''

    def reset_ui(self):
        self.track_list.clear()
        self.track_list.show()
        self.log_output.clear()
        self.progress_bar.setValue(0)
        self.progress_bar.hide()
        self.stop_btn.hide()
        self.pause_resume_btn.hide()
        self.pause_resume_btn.setText('Pause')
        self.reset_info_widget()
        self.hide_track_buttons()
        if hasattr(self, 'search_input'):
            self.search_input.clear()
        if hasattr(self, 'search_widget'):
            self.search_widget.hide()
    
    def get_themed_icon(self, icon_name):
        icon_path = os.path.join(os.path.dirname(__file__), "icons", icon_name)
        if not os.path.exists(icon_path):
            return QIcon()
        
        with open(icon_path, 'r') as f:
            svg_content = f.read()
        
        svg_content = svg_content.replace('currentColor', self.current_theme_color)
        
        renderer = QSvgRenderer(svg_content.encode())
        pixmap = QPixmap(16, 16)
        pixmap.fill(QColor(0, 0, 0, 0))
        
        painter = QPainter(pixmap)
        renderer.render(painter)
        painter.end()
        
        return QIcon(pixmap)

    def initUI(self):
        self.setWindowTitle('SpotiFLAC')
        self.setFixedWidth(650)
        self.setMinimumHeight(350)  
        
        icon_path = os.path.join(os.path.dirname(__file__), "icons", "icon.svg")
        if os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))
            
        self.main_layout = QVBoxLayout()
        
        self.setup_spotify_section()
        self.setup_tabs()
        
        self.setLayout(self.main_layout)

    def setup_spotify_section(self):
        spotify_layout = QHBoxLayout()
        spotify_label = QLabel('Spotify URL:')
        spotify_label.setFixedWidth(100)
        
        self.spotify_url = QLineEdit()
        self.spotify_url.setPlaceholderText("Enter Spotify URL")
        self.spotify_url.setClearButtonEnabled(True)
        self.spotify_url.setText(self.last_url)
        self.spotify_url.textChanged.connect(self.save_url)
        
        self.fetch_btn = QPushButton('Fetch')
        self.fetch_btn.setFixedWidth(80)
        self.fetch_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.fetch_btn.clicked.connect(self.fetch_tracks)
        
        spotify_layout.addWidget(spotify_label)
        spotify_layout.addWidget(self.spotify_url)
        spotify_layout.addWidget(self.fetch_btn)
        self.main_layout.addLayout(spotify_layout)

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

    def format_track_date(self, release_date):
        if not release_date:
            return ""
        
        try:
            if len(release_date) == 4:
                date_obj = datetime.strptime(release_date, "%Y")
                if self.date_format == "yyyy":
                    return date_obj.strftime('%Y')
                else:
                    return date_obj.strftime('%Y')
            elif len(release_date) == 7:
                date_obj = datetime.strptime(release_date, "%Y-%m")
                if self.date_format == "dd_mm_yyyy":
                    return date_obj.strftime('%m-%Y')
                elif self.date_format == "yyyy_mm_dd":
                    return date_obj.strftime('%Y-%m')
                else:
                    return date_obj.strftime('%Y')
            else:
                date_obj = datetime.strptime(release_date, "%Y-%m-%d")
                if self.date_format == "dd_mm_yyyy":
                    return date_obj.strftime('%d-%m-%Y')
                elif self.date_format == "yyyy_mm_dd":
                    return date_obj.strftime('%Y-%m-%d')
                else:
                    return date_obj.strftime('%Y')
        except ValueError:
            return release_date

    def update_track_list_display(self):
        self.track_list.clear()
        for i, track in enumerate(self.tracks, 1):
            duration = self.format_duration(track.duration_ms)
            formatted_date = self.format_track_date(track.release_date)
            
            if self.track_list_format == "artist_track_date_duration":
                display_parts = [f"{i}. {track.artists} - {track.title}"]
                if formatted_date:
                    display_parts.append(formatted_date)
                display_parts.append(duration)
                display_text = " • ".join(display_parts)
            elif self.track_list_format == "track_artist_date":
                display_parts = [f"{i}. {track.title} - {track.artists}"]
                if formatted_date:
                    display_parts.append(formatted_date)
                display_text = " • ".join(display_parts)
            elif self.track_list_format == "artist_track_date":
                display_parts = [f"{i}. {track.artists} - {track.title}"]
                if formatted_date:
                    display_parts.append(formatted_date)
                display_text = " • ".join(display_parts)
            elif self.track_list_format == "track_artist_duration":
                display_text = f"{i}. {track.title} - {track.artists} • {duration}"
            elif self.track_list_format == "artist_track_duration":
                display_text = f"{i}. {track.artists} - {track.title} • {duration}"
            elif self.track_list_format == "track_artist":
                display_text = f"{i}. {track.title} - {track.artists}"
            elif self.track_list_format == "artist_track":
                display_text = f"{i}. {track.artists} - {track.title}"
            else:
                display_parts = [f"{i}. {track.title} - {track.artists}"]
                if formatted_date:
                    display_parts.append(formatted_date)
                display_parts.append(duration)
                display_text = " • ".join(display_parts)
            
            self.track_list.addItem(display_text)

    def browse_output(self):
        directory = QFileDialog.getExistingDirectory(self, "Select Output Directory")
        if directory:
            self.output_dir.setText(directory)
            self.save_settings()

    def setup_tabs(self):
        self.tab_widget = QTabWidget()
        self.main_layout.addWidget(self.tab_widget)

        self.setup_dashboard_tab()
        self.setup_process_tab()
        self.setup_settings_tab()
        self.setup_theme_tab()
        self.setup_about_tab()

    def setup_dashboard_tab(self):
        dashboard_tab = QWidget()
        dashboard_layout = QVBoxLayout()

        self.setup_info_widget()
        dashboard_layout.addWidget(self.info_widget)

        self.track_list = QListWidget()
        self.track_list.setSelectionMode(QAbstractItemView.SelectionMode.ExtendedSelection)
        dashboard_layout.addWidget(self.track_list)
        
        self.setup_track_buttons()
        dashboard_layout.addLayout(self.btn_layout)
        dashboard_layout.addWidget(self.single_track_container)

        dashboard_tab.setLayout(dashboard_layout)
        self.tab_widget.addTab(dashboard_tab, "Dashboard")

        self.hide_track_buttons()

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
        
        self.setup_search_widget()
        info_layout.addWidget(self.search_widget)
        
        self.info_widget.setLayout(info_layout)
        self.info_widget.setFixedHeight(100)
        self.info_widget.hide()

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
        self.download_btn = QPushButton(' Download')
        self.download_btn.setIcon(self.get_themed_icon('download.svg'))
        self.delete_btn = QPushButton(' Delete')
        self.delete_btn.setIcon(self.get_themed_icon('trash.svg'))
        
        for btn in [self.download_btn, self.delete_btn]:
            btn.setFixedWidth(120)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            
        self.download_btn.clicked.connect(self.download_tracks_action)
        self.delete_btn.clicked.connect(self.delete_tracks)
        
        self.btn_layout.addStretch()
        self.btn_layout.addWidget(self.download_btn)
        self.btn_layout.addWidget(self.delete_btn)
        self.btn_layout.addStretch()
        
        self.single_track_container = QWidget()
        single_track_layout = QHBoxLayout(self.single_track_container)
        single_track_layout.setContentsMargins(0, 0, 0, 0)
        
        self.single_download_btn = QPushButton(' Download')
        self.single_download_btn.setIcon(self.get_themed_icon('download.svg'))
        self.single_delete_btn = QPushButton(' Delete')
        self.single_delete_btn.setIcon(self.get_themed_icon('trash.svg'))
        
        for btn in [self.single_download_btn, self.single_delete_btn]:
            btn.setFixedWidth(120)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            
        self.single_download_btn.clicked.connect(self.download_tracks_action)
        self.single_delete_btn.clicked.connect(self.delete_tracks)
        
        single_track_layout.addStretch()
        single_track_layout.addWidget(self.single_download_btn)
        single_track_layout.addWidget(self.single_delete_btn)
        single_track_layout.addStretch()
        
        self.single_track_container.hide()

    def setup_process_tab(self):
        self.process_tab = QWidget()
        process_layout = QVBoxLayout()
        process_layout.setSpacing(5)
        
        self.log_output = QTextEdit()
        self.log_output.setReadOnly(True)
        process_layout.addWidget(self.log_output)
        
        fix_error_layout = QHBoxLayout()
        fix_error_layout.addStretch()
        self.fix_error_btn = QPushButton(' Fix Error')
        self.fix_error_btn.setIcon(self.get_themed_icon('tool.svg'))
        self.fix_error_btn.setFixedWidth(120)
        self.fix_error_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.fix_error_btn.clicked.connect(self.fix_error_action)
        self.fix_error_btn.hide()
        fix_error_layout.addWidget(self.fix_error_btn)
        fix_error_layout.addStretch()
        process_layout.addLayout(fix_error_layout)
        
        progress_time_layout = QVBoxLayout()
        progress_time_layout.setSpacing(2)
        
        self.progress_bar = QProgressBar()
        progress_time_layout.addWidget(self.progress_bar)
        
        self.time_label = QLabel("00:00:00")
        self.time_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        progress_time_layout.addWidget(self.time_label)
        
        process_layout.addLayout(progress_time_layout)
        
        control_layout = QHBoxLayout()
        self.stop_btn = QPushButton('Stop')
        self.pause_resume_btn = QPushButton('Pause')
        
        self.stop_btn.setFixedWidth(120)
        self.pause_resume_btn.setFixedWidth(120)
        
        self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.pause_resume_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        
        self.stop_btn.clicked.connect(self.stop_download)
        self.pause_resume_btn.clicked.connect(self.toggle_pause_resume)
        
        self.remove_successful_btn = QPushButton(' Remove Finished Tracks')
        self.remove_successful_btn.setIcon(self.get_themed_icon('circle-x.svg'))
        self.remove_successful_btn.setFixedWidth(200)
        self.remove_successful_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.remove_successful_btn.clicked.connect(self.remove_successful_downloads)
        
        control_layout.addStretch()
        control_layout.addWidget(self.stop_btn)
        control_layout.addWidget(self.pause_resume_btn)
        control_layout.addWidget(self.remove_successful_btn)
        control_layout.addStretch()
        
        process_layout.addLayout(control_layout)
        
        self.process_tab.setLayout(process_layout)
        
        self.tab_widget.addTab(self.process_tab, "Process")
        
        self.progress_bar.hide()
        self.time_label.hide()
        self.stop_btn.hide()
        self.pause_resume_btn.hide()
        self.remove_successful_btn.hide()

    def setup_settings_tab(self):
        settings_tab = QWidget()
        settings_layout = QVBoxLayout()
        settings_layout.setSpacing(4)
        settings_layout.setContentsMargins(10, 10, 10, 10)

        output_group = QWidget()
        output_layout = QVBoxLayout(output_group)
        output_layout.setSpacing(2)
        output_layout.setContentsMargins(0, 0, 0, 0)
        
        output_label = QLabel('Output Directory')
        output_label.setStyleSheet("font-weight: bold; margin-top: 0px; margin-bottom: 5px;")
        output_layout.addWidget(output_label)
        
        output_dir_layout = QHBoxLayout()
        self.output_dir = QLineEdit()
        self.output_dir.setText(self.last_output_path)
        self.output_dir.textChanged.connect(self.save_settings)
        
        self.output_browse = QPushButton('Browse')
        self.output_browse.setFixedWidth(80)
        self.output_browse.setCursor(Qt.CursorShape.PointingHandCursor)
        self.output_browse.clicked.connect(self.browse_output)
        
        output_dir_layout.addWidget(self.output_dir)
        output_dir_layout.addSpacing(5)
        output_dir_layout.addWidget(self.output_browse)
        
        output_layout.addLayout(output_dir_layout)
        
        settings_layout.addWidget(output_group)

        dashboard_group = QWidget()
        dashboard_layout = QVBoxLayout(dashboard_group)
        dashboard_layout.setSpacing(3)
        dashboard_layout.setContentsMargins(0, 0, 0, 0)
        
        dashboard_label = QLabel('Dashboard Settings')
        dashboard_label.setStyleSheet("font-weight: bold; margin-top: 8px; margin-bottom: 5px;")
        dashboard_layout.addWidget(dashboard_label)
        
        dashboard_controls_layout = QHBoxLayout()
        
        list_format_label = QLabel('Track List View:')
        list_format_label.setFixedWidth(90)
        
        self.track_list_format_dropdown = QComboBox()
        self.track_list_format_dropdown.addItem("Track - Artist - Date - Duration", "track_artist_date_duration")
        self.track_list_format_dropdown.addItem("Artist - Track - Date - Duration", "artist_track_date_duration")
        self.track_list_format_dropdown.addItem("Track - Artist - Date", "track_artist_date")
        self.track_list_format_dropdown.addItem("Artist - Track - Date", "artist_track_date")
        self.track_list_format_dropdown.addItem("Track - Artist - Duration", "track_artist_duration")
        self.track_list_format_dropdown.addItem("Artist - Track - Duration", "artist_track_duration")
        self.track_list_format_dropdown.addItem("Track - Artist", "track_artist")
        self.track_list_format_dropdown.addItem("Artist - Track", "artist_track")
        self.track_list_format_dropdown.currentIndexChanged.connect(self.save_track_list_format)
        
        dashboard_controls_layout.addWidget(list_format_label)
        dashboard_controls_layout.addWidget(self.track_list_format_dropdown)
        
        dashboard_controls_layout.addSpacing(15)
        
        date_format_label = QLabel('Date Format:')
        date_format_label.setFixedWidth(80)
        
        self.date_format_dropdown = QComboBox()
        self.date_format_dropdown.addItem("DD-MM-YYYY", "dd_mm_yyyy")
        self.date_format_dropdown.addItem("YYYY-MM-DD", "yyyy_mm_dd")
        self.date_format_dropdown.addItem("YYYY", "yyyy")
        self.date_format_dropdown.currentIndexChanged.connect(self.save_date_format)
        
        dashboard_controls_layout.addWidget(date_format_label)
        dashboard_controls_layout.addWidget(self.date_format_dropdown)
        dashboard_controls_layout.addStretch()
        
        dashboard_layout.addLayout(dashboard_controls_layout)
        
        settings_layout.addWidget(dashboard_group)

        file_group = QWidget()
        file_layout = QVBoxLayout(file_group)
        file_layout.setSpacing(2)
        file_layout.setContentsMargins(0, 0, 0, 0)
        
        file_label = QLabel('File Settings')
        file_label.setStyleSheet("font-weight: bold; margin-top: 8px; margin-bottom: 5px;")
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
        format_layout.addSpacing(10)
        format_layout.addWidget(self.artist_title_radio)
        format_layout.addSpacing(10)
        format_layout.addWidget(self.title_only_radio)
        format_layout.addStretch()
        file_layout.addLayout(format_layout)

        checkbox_layout = QHBoxLayout()
        
        self.artist_subfolder_checkbox = QCheckBox('Artist Subfolder (Playlist)')
        self.artist_subfolder_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.artist_subfolder_checkbox.setChecked(self.use_artist_subfolders)
        self.artist_subfolder_checkbox.toggled.connect(self.save_artist_subfolder_setting)
        checkbox_layout.addWidget(self.artist_subfolder_checkbox)
        checkbox_layout.addSpacing(10)
        
        self.album_subfolder_checkbox = QCheckBox('Album Subfolder (Playlist)')
        self.album_subfolder_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.album_subfolder_checkbox.setChecked(self.use_album_subfolders)
        self.album_subfolder_checkbox.toggled.connect(self.save_album_subfolder_setting)
        checkbox_layout.addWidget(self.album_subfolder_checkbox)
        checkbox_layout.addSpacing(10)
        
        self.track_number_checkbox = QCheckBox('Track Number')
        self.track_number_checkbox.setCursor(Qt.CursorShape.PointingHandCursor)
        self.track_number_checkbox.setChecked(self.use_track_numbers)
        self.track_number_checkbox.toggled.connect(self.save_track_numbering)
        checkbox_layout.addWidget(self.track_number_checkbox)
        
        checkbox_layout.addStretch()
        file_layout.addLayout(checkbox_layout)
        
        settings_layout.addWidget(file_group)

        auth_group = QWidget()
        auth_layout = QVBoxLayout(auth_group)
        auth_layout.setSpacing(2)
        auth_layout.setContentsMargins(0, 0, 0, 0)
        
        auth_label = QLabel('Service Settings')
        auth_label.setStyleSheet("font-weight: bold; margin-top: 8px; margin-bottom: 5px;")
        auth_layout.addWidget(auth_label)

        service_api_layout = QHBoxLayout()

        service_label = QLabel('Service:')
        service_label.setFixedWidth(60)
        
        self.service_dropdown = ServiceComboBox()
        self.service_dropdown.setFixedWidth(120)
        self.service_dropdown.currentIndexChanged.connect(self.on_service_changed)
        
        service_api_layout.addWidget(service_label)
        service_api_layout.addWidget(self.service_dropdown)
        service_api_layout.addSpacing(15)
        
        self.tidal_api_label = QLabel('Tidal API:')
        self.tidal_api_label.setFixedWidth(70)
        
        self.tidal_api_dropdown = QComboBox()
        self.tidal_api_dropdown.setItemDelegate(TidalAPIDelegate())
        self.tidal_api_dropdown.addItem("Default (401658)", "https://hifi.401658.xyz")
        self.tidal_api_dropdown.addItem("Auto-select fastest", "auto")
        self.tidal_api_dropdown.currentIndexChanged.connect(self.on_tidal_api_changed)
        
        self.refresh_api_btn = QPushButton('Refresh')
        self.refresh_api_btn.setFixedWidth(80)
        self.refresh_api_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.refresh_api_btn.clicked.connect(self.refresh_tidal_apis)
        
        service_api_layout.addWidget(self.tidal_api_label)
        service_api_layout.addWidget(self.tidal_api_dropdown)
        service_api_layout.addSpacing(5)
        service_api_layout.addWidget(self.refresh_api_btn)
        service_api_layout.addStretch()
        
        auth_layout.addLayout(service_api_layout)
        
        self.refresh_tidal_apis()
        
        self.update_tidal_api_visibility()
        
        settings_layout.addWidget(auth_group)
        settings_layout.addStretch()
        settings_tab.setLayout(settings_layout)
        self.tab_widget.addTab(settings_tab, "Settings")
        self.set_combobox_value(self.service_dropdown, self.service)
        self.set_combobox_value(self.track_list_format_dropdown, self.track_list_format)
        self.set_combobox_value(self.date_format_dropdown, self.date_format)
        
        self.set_combobox_value(self.tidal_api_dropdown, self.tidal_api)
        
    def setup_theme_tab(self):
        theme_tab = QWidget()
        theme_layout = QVBoxLayout()
        theme_layout.setSpacing(8)
        theme_layout.setContentsMargins(8, 15, 15, 15)

        grid_layout = QVBoxLayout()
        
        self.color_buttons = {}
        
        first_row_palettes = [
            ("Red", [
                ("#FFCDD2", "100"), ("#EF9A9A", "200"), ("#E57373", "300"), ("#EF5350", "400"), ("#F44336", "500"), ("#E53935", "600"), ("#D32F2F", "700"), ("#C62828", "800"), ("#B71C1C", "900"), ("#FF8A80", "A100"), ("#FF5252", "A200"), ("#FF1744", "A400"), ("#D50000", "A700")
            ]),
            ("Pink", [
                ("#F8BBD0", "100"), ("#F48FB1", "200"), ("#F06292", "300"), ("#EC407A", "400"), ("#E91E63", "500"), ("#D81B60", "600"), ("#C2185B", "700"), ("#AD1457", "800"), ("#880E4F", "900"), ("#FF80AB", "A100"), ("#FF4081", "A200"), ("#F50057", "A400"), ("#C51162", "A700")
            ]),
            ("Purple", [
                ("#E1BEE7", "100"), ("#CE93D8", "200"), ("#BA68C8", "300"), ("#AB47BC", "400"), ("#9C27B0", "500"), ("#8E24AA", "600"), ("#7B1FA2", "700"), ("#6A1B9A", "800"), ("#4A148C", "900"), ("#EA80FC", "A100"), ("#E040FB", "A200"), ("#D500F9", "A400"), ("#AA00FF", "A700")
            ])
        ]
        
        second_row_palettes = [
            ("Deep Purple", [
                ("#D1C4E9", "100"), ("#B39DDB", "200"), ("#9575CD", "300"), ("#7E57C2", "400"), ("#673AB7", "500"), ("#5E35B1", "600"), ("#512DA8", "700"), ("#4527A0", "800"), ("#311B92", "900"), ("#B388FF", "A100"), ("#7C4DFF", "A200"), ("#651FFF", "A400"), ("#6200EA", "A700")
            ]),
            ("Indigo", [
                ("#C5CAE9", "100"), ("#9FA8DA", "200"), ("#7986CB", "300"), ("#5C6BC0", "400"), ("#3F51B5", "500"), ("#3949AB", "600"), ("#303F9F", "700"), ("#283593", "800"), ("#1A237E", "900"), ("#8C9EFF", "A100"), ("#536DFE", "A200"), ("#3D5AFE", "A400"), ("#304FFE", "A700")
            ]),
            ("Blue", [
                ("#BBDEFB", "100"), ("#90CAF9", "200"), ("#64B5F6", "300"), ("#42A5F5", "400"), ("#2196F3", "500"), ("#1E88E5", "600"), ("#1976D2", "700"), ("#1565C0", "800"), ("#0D47A1", "900"), ("#82B1FF", "A100"), ("#448AFF", "A200"), ("#2979FF", "A400"), ("#2962FF", "A700")
            ])
        ]
        
        third_row_palettes = [
            ("Light Blue", [
                ("#B3E5FC", "100"), ("#81D4FA", "200"), ("#4FC3F7", "300"), ("#29B6F6", "400"), ("#03A9F4", "500"), ("#039BE5", "600"), ("#0288D1", "700"), ("#0277BD", "800"), ("#01579B", "900"), ("#80D8FF", "A100"), ("#40C4FF", "A200"), ("#00B0FF", "A400"), ("#0091EA", "A700")
            ]),
            ("Cyan", [
                ("#B2EBF2", "100"), ("#80DEEA", "200"), ("#4DD0E1", "300"), ("#26C6DA", "400"), ("#00BCD4", "500"), ("#00ACC1", "600"), ("#0097A7", "700"), ("#00838F", "800"), ("#006064", "900"), ("#84FFFF", "A100"), ("#18FFFF", "A200"), ("#00E5FF", "A400"), ("#00B8D4", "A700")
            ]),
            ("Teal", [
                ("#B2DFDB", "100"), ("#80CBC4", "200"), ("#4DB6AC", "300"), ("#26A69A", "400"), ("#009688", "500"), ("#00897B", "600"), ("#00796B", "700"), ("#00695C", "800"), ("#004D40", "900"), ("#A7FFEB", "A100"), ("#64FFDA", "A200"), ("#1DE9B6", "A400"), ("#00BFA5", "A700")
            ])
        ]
        
        fourth_row_palettes = [
            ("Green", [
                ("#C8E6C9", "100"), ("#A5D6A7", "200"), ("#81C784", "300"), ("#66BB6A", "400"), ("#4CAF50", "500"), ("#43A047", "600"), ("#388E3C", "700"), ("#2E7D32", "800"), ("#1B5E20", "900"), ("#B9F6CA", "A100"), ("#69F0AE", "A200"), ("#00E676", "A400"), ("#00C853", "A700")
            ]),
            ("Light Green", [
                ("#DCEDC8", "100"), ("#C5E1A5", "200"), ("#AED581", "300"), ("#9CCC65", "400"), ("#8BC34A", "500"), ("#7CB342", "600"), ("#689F38", "700"), ("#558B2F", "800"), ("#33691E", "900"), ("#CCFF90", "A100"), ("#B2FF59", "A200"), ("#76FF03", "A400"), ("#64DD17", "A700")
            ]),
            ("Lime", [
                ("#F0F4C3", "100"), ("#E6EE9C", "200"), ("#DCE775", "300"), ("#D4E157", "400"), ("#CDDC39", "500"), ("#C0CA33", "600"), ("#AFB42B", "700"), ("#9E9D24", "800"), ("#827717", "900"), ("#F4FF81", "A100"), ("#EEFF41", "A200"), ("#C6FF00", "A400"), ("#AEEA00", "A700")
            ])
        ]
        
        fifth_row_palettes = [
            ("Yellow", [
                ("#FFF9C4", "100"), ("#FFF59D", "200"), ("#FFF176", "300"), ("#FFEE58", "400"), ("#FFEB3B", "500"), ("#FDD835", "600"), ("#FBC02D", "700"), ("#F9A825", "800"), ("#F57F17", "900"), ("#FFFF8D", "A100"), ("#FFFF00", "A200"), ("#FFEA00", "A400"), ("#FFD600", "A700")
            ]),
            ("Amber", [
                ("#FFECB3", "100"), ("#FFE082", "200"), ("#FFD54F", "300"), ("#FFCA28", "400"), ("#FFC107", "500"), ("#FFB300", "600"), ("#FFA000", "700"), ("#FF8F00", "800"), ("#FF6F00", "900"), ("#FFE57F", "A100"), ("#FFD740", "A200"), ("#FFC400", "A400"), ("#FFAB00", "A700")
            ]),
            ("Orange", [
                ("#FFE0B2", "100"), ("#FFCC80", "200"), ("#FFB74D", "300"), ("#FFA726", "400"), ("#FF9800", "500"), ("#FB8C00", "600"), ("#F57C00", "700"), ("#EF6C00", "800"), ("#E65100", "900"), ("#FFD180", "A100"), ("#FFAB40", "A200"), ("#FF9100", "A400"), ("#FF6D00", "A700")
            ])
        ]
        
        for row_palettes in [first_row_palettes, second_row_palettes, third_row_palettes, fourth_row_palettes, fifth_row_palettes]:
            row_layout = QHBoxLayout()
            row_layout.setSpacing(15)
            
            for palette_name, colors in row_palettes:
                column_layout = QVBoxLayout()
                column_layout.setSpacing(3)
                
                palette_label = QLabel(palette_name)
                palette_label.setStyleSheet("margin-bottom: 2px;")
                palette_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
                column_layout.addWidget(palette_label)
                
                color_buttons_layout = QHBoxLayout()
                color_buttons_layout.setSpacing(3)
                
                for color_hex, color_name in colors:
                    color_btn = QPushButton()
                    color_btn.setFixedSize(18, 18)
                    
                    is_current = color_hex == self.current_theme_color
                    border_style = "2px solid #fff" if is_current else "none"
                    
                    color_btn.setStyleSheet(f"""
                        QPushButton {{
                            background-color: {color_hex};
                            border: {border_style};
                            border-radius: 9px;
                        }}
                        QPushButton:hover {{
                            border: 2px solid #fff;
                        }}
                        QPushButton:pressed {{
                            border: 2px solid #fff;
                        }}
                    """)
                    color_btn.setCursor(Qt.CursorShape.PointingHandCursor)
                    color_btn.setToolTip(f"{palette_name} {color_name}\n{color_hex}")
                    color_btn.clicked.connect(lambda checked, color=color_hex, btn=color_btn: self.change_theme_color(color, btn))
                    
                    self.color_buttons[color_hex] = color_btn
                    
                    color_buttons_layout.addWidget(color_btn)
                
                column_layout.addLayout(color_buttons_layout)
                row_layout.addLayout(column_layout)
            
            grid_layout.addLayout(row_layout)

        theme_layout.addLayout(grid_layout)
        theme_layout.addStretch()

        theme_tab.setLayout(theme_layout)
        self.tab_widget.addTab(theme_tab, "Theme")

    def change_theme_color(self, color, clicked_btn=None):
        if hasattr(self, 'color_buttons'):
            for color_hex, btn in self.color_buttons.items():
                if color_hex == self.current_theme_color:
                    btn.setStyleSheet(f"""
                        QPushButton {{
                            background-color: {color_hex};
                            border: none;
                            border-radius: 9px;
                        }}
                        QPushButton:hover {{
                            border: 2px solid #fff;
                        }}
                        QPushButton:pressed {{
                            border: 2px solid #fff;
                        }}
                    """)
                    break
        
        self.current_theme_color = color
        self.settings.setValue('theme_color', color)
        self.settings.sync()
        
        if clicked_btn:
            clicked_btn.setStyleSheet(f"""
                QPushButton {{
                    background-color: {color};
                    border: 2px solid #fff;
                    border-radius: 9px;
                }}
                QPushButton:hover {{
                    border: 2px solid #fff;
                }}
                QPushButton:pressed {{
                    border: 2px solid #fff;
                }}
            """)
        
        qdarktheme.setup_theme(
            custom_colors={
                "[dark]": {
                    "primary": color,
                }
            }
        )
        
        self.refresh_button_icons()
    
    def refresh_button_icons(self):
        if hasattr(self, 'download_btn'):
            self.download_btn.setIcon(self.get_themed_icon('download.svg'))
        if hasattr(self, 'delete_btn'):
            self.delete_btn.setIcon(self.get_themed_icon('trash.svg'))
        
        if hasattr(self, 'single_download_btn'):
            self.single_download_btn.setIcon(self.get_themed_icon('download.svg'))
        if hasattr(self, 'single_delete_btn'):
            self.single_delete_btn.setIcon(self.get_themed_icon('trash.svg'))
        
        if hasattr(self, 'fix_error_btn'):
            self.fix_error_btn.setIcon(self.get_themed_icon('tool.svg'))
        
        if hasattr(self, 'remove_successful_btn'):
            self.remove_successful_btn.setIcon(self.get_themed_icon('circle-x.svg'))
        
    def setup_about_tab(self):
        about_tab = QWidget()
        about_layout = QVBoxLayout()
        about_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        about_layout.setSpacing(15)

        sections = [
            ("Check for Updates", "Check", "https://github.com/afkarxyz/SpotiFLAC/releases"),
            ("Report an Issue", "Report", "https://github.com/afkarxyz/SpotiFLAC/issues")
        ]

        for title, button_text, url in sections:
            section_widget = QWidget()
            section_layout = QVBoxLayout(section_widget)
            section_layout.setSpacing(10)
            section_layout.setContentsMargins(0, 0, 0, 0)

            label = QLabel(title)
            label.setStyleSheet("color: palette(text); font-weight: bold;")
            label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            section_layout.addWidget(label)

            button = QPushButton(button_text)
            button.setFixedSize(120, 25)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.clicked.connect(lambda _, url=url: QDesktopServices.openUrl(QUrl(url if url.startswith(('http://', 'https://')) else f'https://{url}')))
            section_layout.addWidget(button, alignment=Qt.AlignmentFlag.AlignCenter)

            about_layout.addWidget(section_widget)

        footer_label = QLabel(f"v{self.current_version} | October 2025")
        about_layout.addWidget(footer_label, alignment=Qt.AlignmentFlag.AlignCenter)

        about_tab.setLayout(about_layout)
        self.tab_widget.addTab(about_tab, "About")
            
    def on_service_changed(self, index):
        service = self.service_dropdown.currentData()
        self.service = service
        self.settings.setValue('service', service)
        self.settings.sync()
        self.log_output.append(f"Service changed to: {self.service_dropdown.currentText()}")
        self.update_tidal_api_visibility()
    
    def update_tidal_api_visibility(self):
        is_tidal = self.service_dropdown.currentData() == 'tidal'
        self.tidal_api_label.setVisible(is_tidal)
        self.tidal_api_dropdown.setVisible(is_tidal)
        self.refresh_api_btn.setVisible(is_tidal)
    
    def on_tidal_api_changed(self, index):
        selected_api = self.tidal_api_dropdown.currentData()
        if selected_api:
            self.tidal_api = selected_api
            self.settings.setValue('tidal_api', selected_api)
            self.settings.sync()
            self.log_output.append(f"Tidal API changed to: {self.tidal_api_dropdown.currentText()}")
    
    def refresh_tidal_apis(self):
        try:
            self.log_output.append("Fetching available Tidal APIs...")
            apis = TidalDownloader.get_available_apis()
            
            while self.tidal_api_dropdown.count() > 2:
                self.tidal_api_dropdown.removeItem(2)
            
            if apis:
                for api in apis:
                    url = api.get('url', '')
                    uptime = api.get('uptime', 0)
                    avg_time = api.get('avg_response_time', 0)
                    status = "UP" if api.get('last_check', {}).get('success') else "DOWN"
                    
                    domain = url.replace('https://', '').replace('http://', '')
                    label = f"{domain} ({uptime:.0f}%, {avg_time}ms)"
                    
                    status_data = {
                        'status': status,
                        'uptime': uptime,
                        'avg_time': avg_time
                    }
                    
                    self.tidal_api_dropdown.addItem(label, url)
                    item_index = self.tidal_api_dropdown.count() - 1
                    self.tidal_api_dropdown.setItemData(item_index, status_data, Qt.ItemDataRole.UserRole)
                
                self.log_output.append(f"Found {len(apis)} available Tidal APIs")
            else:
                self.log_output.append("No APIs found, using default")
        except Exception as e:
            self.log_output.append(f"Error fetching APIs: {str(e)}")

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
    
    def save_artist_subfolder_setting(self):
        self.use_artist_subfolders = self.artist_subfolder_checkbox.isChecked()
        self.settings.setValue('use_artist_subfolders', self.use_artist_subfolders)
        self.settings.sync()
    
    def save_album_subfolder_setting(self):
        self.use_album_subfolders = self.album_subfolder_checkbox.isChecked()
        self.settings.setValue('use_album_subfolders', self.use_album_subfolders)
        self.settings.sync()
    
    def save_track_list_format(self):
        format_value = self.track_list_format_dropdown.currentData()
        self.track_list_format = format_value
        self.settings.setValue('track_list_format', format_value)
        self.settings.sync()
        if self.tracks:
            self.update_track_list_display()
    
    def save_date_format(self):
        format_value = self.date_format_dropdown.currentData()
        self.date_format = format_value
        self.settings.setValue('date_format', format_value)
        self.settings.sync()
        if self.tracks:
            self.update_track_list_display()
    
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
            if hasattr(self, 'fix_error_btn') and self.fix_error_btn.isVisible():
                self.fix_error_btn.hide()
            
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
            elif url_info["type"] == "artist_discography":
                self.handle_discography_metadata(metadata)
            elif url_info["type"] == "artist":
                self.handle_artist_metadata(metadata)
                
            self.update_button_states()
            self.tab_widget.setCurrentIndex(0)
        except Exception as e:
            self.log_output.append(f'Error: {str(e)}')
    
    def on_metadata_error(self, error_message):
        self.log_output.append(f'Error: {error_message}')
        
        if "Failed to get raw data" in error_message or "Failed to fetch secrets" in error_message or "Failed to get access token" in error_message:
            if not hasattr(self, 'fix_error_btn') or not self.fix_error_btn.isVisible():
                self.show_fix_error_button()
    
    def show_fix_error_button(self):
        if hasattr(self, 'fix_error_btn'):
            self.fix_error_btn.show()
    
    def fix_error_action(self):
        self.fix_error_btn.setEnabled(False)
        self.fix_error_btn.setText("Fixing...")
        
        self.scrape_worker = SecretScrapeWorker()
        self.scrape_worker.progress.connect(lambda msg: self.log_output.append(msg))
        self.scrape_worker.finished.connect(self.on_scrape_finished)
        self.scrape_worker.start()
    
    def on_scrape_finished(self, success, message):
        self.log_output.append(message)
        
        if hasattr(self, 'fix_error_btn'):
            self.fix_error_btn.setEnabled(True)
            self.fix_error_btn.setText("Fix Error")
            
            if success:
                self.fix_error_btn.hide()
        
        if success:
            url = self.spotify_url.text().strip()
            if url:
                self.log_output.append("Retrying fetch...")
                QTimer.singleShot(1000, self.fetch_tracks)

    def handle_track_metadata(self, track_data):
        track_id = track_data["external_urls"].split("/")[-1]
        
        track = Track(
            external_urls=track_data["external_urls"],
            title=track_data["name"],
            artists=track_data["artists"],
            album=track_data["album_name"],
            track_number=1,
            duration_ms=track_data.get("duration_ms", 0),
            id=track_id,
            isrc=track_data.get("isrc", ""),
            release_date=track_data.get("release_date", "")
        )
        
        self.tracks = [track]
        self.all_tracks = [track]
        self.is_single_track = True
        self.is_album = self.is_playlist = False
        self.album_or_playlist_name = f"{self.tracks[0].title} - {self.tracks[0].artists}"
        
        metadata = {
            'title': track_data["name"],
            'artists': track_data["artists"],
            'releaseDate': track_data["release_date"],
            'cover': track_data["images"],
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
                release_date=track.get("release_date", "")
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
                album=track["album_name"],
                track_number=track.get("track_number", len(self.tracks) + 1),
                duration_ms=track.get("duration_ms", 0),
                id=track_id,
                isrc=track.get("isrc", ""),
                release_date=track.get("release_date", "")
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

    def handle_discography_metadata(self, discography_data):
        artist_info = discography_data["artist_info"]
        self.album_or_playlist_name = f"{artist_info['name']} - Discography ({artist_info['discography_type'].title()})"
        self.tracks = []
        
        for track in discography_data["track_list"]:
            track_id = track["external_urls"].split("/")[-1] if track.get("external_urls") else ""
            
            self.tracks.append(Track(
                external_urls=track.get("external_urls", ""),
                title=track["name"],
                artists=track["artists"],
                album=track["album_name"],
                track_number=track.get("track_number", len(self.tracks) + 1),
                duration_ms=track.get("duration_ms", 0),
                id=track_id,
                isrc=track.get("isrc", ""),
                release_date=track.get("release_date", "")
            ))
        
        self.all_tracks = self.tracks.copy()
        self.is_playlist = True
        self.is_album = self.is_single_track = False
        
        metadata = {
            'title': f"{artist_info['name']} - Discography",
            'artists': f"{artist_info['discography_type'].title()} • {artist_info['total_albums']} albums",
            'cover': artist_info["images"],
            'followers': artist_info.get("followers", 0),
            'total_tracks': len(self.tracks),
            'discography_type': artist_info['discography_type']
        }
        self.update_display_after_fetch(metadata)

    def handle_artist_metadata(self, artist_data):
        self.reset_state()
        
        metadata = {
            'title': artist_data["artist"]["name"],
            'artists': f"Followers: {artist_data['artist']['followers']:,}",
            'cover': artist_data["artist"]["images"],
            'followers': artist_data["artist"]["followers"],
            'genres': artist_data["artist"].get("genres", [])
        }
        
        self.update_info_widget_artist_only(metadata)

    def update_display_after_fetch(self, metadata):
        self.track_list.setVisible(not self.is_single_track)
        
        if not self.is_single_track:
            self.search_widget.show()
            self.update_track_list_display()
        else:
            self.search_widget.hide()
        
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
            if metadata.get('discography_type'):
                discography_type = metadata['discography_type'].title()
                self.type_label.setText(f"<b>Discography ({discography_type})</b> • {total_tracks} tracks")
            else:
                self.type_label.setText(f"<b>Playlist</b> • {total_tracks} tracks")
        
        self.network_manager.get(QNetworkRequest(QUrl(metadata['cover'])))
        
        self.info_widget.show()

    def update_info_widget_artist_only(self, metadata):
        self.title_label.setText(metadata['title'])
        self.artists_label.setText(f"<b>Followers</b> {metadata['followers']:,}")
        
        if metadata.get('genres'):
            genres_text = ", ".join(metadata['genres'][:3])
            if len(metadata['genres']) > 3:
                genres_text += f" (+{len(metadata['genres']) - 3} more)"
            self.followers_label.setText(f"<b>Genres</b> {genres_text}")
            self.followers_label.show()
        else:
            self.followers_label.hide()
        
        self.release_date_label.hide()
        self.type_label.setText("<b>Artist Profile</b> • No tracks available for download")
        
        self.network_manager.get(QNetworkRequest(QUrl(metadata['cover'])))
        
        self.track_list.hide()
        self.search_widget.hide()
        self.hide_track_buttons()
        
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
            for btn in [self.download_btn, self.delete_btn]:
                btn.hide()
            
            self.single_track_container.show()
            
            self.single_download_btn.setEnabled(True)
            self.single_delete_btn.setEnabled(True)
            
        else:
            self.single_track_container.hide()
            
            self.download_btn.show()
            self.delete_btn.show()
            
            self.download_btn.setEnabled(True)
            self.delete_btn.setEnabled(True)

    def hide_track_buttons(self):
        buttons = [
            self.download_btn,
            self.delete_btn
        ]
        for btn in buttons:
            btn.hide()
        
        if hasattr(self, 'single_track_container'):
            self.single_track_container.hide()

    def download_tracks_action(self):
        if self.is_single_track:
            self.start_download([0])
        else:
            selected_items = self.track_list.selectedItems()
            
            if not selected_items:
                reply = QMessageBox.question(
                    self,
                    'Confirm Download All',
                    f'No tracks selected. Download all {len(self.tracks)} tracks?',
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    QMessageBox.StandardButton.No
                )
                
                if reply == QMessageBox.StandardButton.Yes:
                    self.start_download(range(len(self.tracks)))
            else:
                selected_indices = [self.track_list.row(item) for item in selected_items]
                self.start_download(selected_indices)
    
    def start_download(self, indices):
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
        
        tidal_api_url = None
        if service == "tidal":
            selected_api = self.tidal_api_dropdown.currentData()
            if selected_api == "auto":
                apis = TidalDownloader.get_available_apis()
                if apis:
                    tidal_api_url = apis[0]['url']
                    self.log_output.append(f"Auto-selected fastest API: {tidal_api_url}")
                else:
                    tidal_api_url = "https://hifi.401658.xyz"
                    self.log_output.append("Using default API: https://hifi.401658.xyz")
            else:
                tidal_api_url = selected_api
        
        self.worker = DownloadWorker(
            tracks_to_download, 
            outpath,
            self.is_single_track, 
            self.is_album, 
            self.is_playlist, 
            self.album_or_playlist_name,
            self.filename_format,
            self.use_track_numbers,
            self.use_artist_subfolders,
            self.use_album_subfolders,
            service,
            tidal_api_url
        )
        self.worker.finished.connect(lambda success, message, failed_tracks, successful_tracks, skipped_tracks: self.on_download_finished(success, message, failed_tracks, successful_tracks, skipped_tracks))
        self.worker.progress.connect(self.update_progress)
        self.worker.start()
        self.start_timer()
        self.update_ui_for_download_start()

    def update_ui_for_download_start(self):
        self.download_btn.setEnabled(False)
        
        if hasattr(self, 'single_download_btn'):
            self.single_download_btn.setEnabled(False)
        if hasattr(self, 'single_delete_btn'):
            self.single_delete_btn.setEnabled(False)
            
        self.stop_btn.show()
        self.pause_resume_btn.show()
        self.progress_bar.show()
        self.progress_bar.setValue(0)
        
        self.tab_widget.setCurrentWidget(self.process_tab)

    def update_progress(self, message, percentage):
        self.log_output.append(message)
        self.log_output.moveCursor(QTextCursor.MoveOperation.End)
        if percentage > 0:
            self.progress_bar.setValue(percentage)

    def stop_download(self):
        if hasattr(self, 'worker'):
            self.worker.stop()
        self.stop_timer()
        self.on_download_finished(True, "Download stopped by user.", [], [], [])
        
    def on_download_finished(self, success, message, failed_tracks, successful_tracks=None, skipped_tracks=None):
        self.progress_bar.hide()
        self.stop_btn.hide()
        self.pause_resume_btn.hide()
        self.pause_resume_btn.setText('Pause')
        self.stop_timer()
        
        if successful_tracks is not None:
            self.successful_downloads = successful_tracks
        if skipped_tracks is not None:
            self.skipped_downloads = skipped_tracks
        
        if (hasattr(self, 'successful_downloads') and self.successful_downloads) or (hasattr(self, 'skipped_downloads') and self.skipped_downloads):
            self.remove_successful_btn.show()
        else:
            self.remove_successful_btn.hide()
        
        self.download_btn.setEnabled(True)
        
        if hasattr(self, 'single_download_btn'):
            self.single_download_btn.setEnabled(True)
        if hasattr(self, 'single_delete_btn'):
            self.single_delete_btn.setEnabled(True)
        
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

    def remove_successful_downloads(self):
        successful_tracks = getattr(self, 'successful_downloads', [])
        skipped_tracks = getattr(self, 'skipped_downloads', [])
        
        if not successful_tracks and not skipped_tracks:
            self.log_output.append("No downloaded or skipped tracks to remove.")
            return
        
        tracks_to_remove = []
        
        for track in self.tracks:
            for successful_track in successful_tracks:
                if (track.title == successful_track.title and 
                    track.artists == successful_track.artists and
                    track.album == successful_track.album):
                    tracks_to_remove.append(track)
                    break
        
        for track in self.tracks:
            for skipped_track in skipped_tracks:
                if (track.title == skipped_track.title and 
                    track.artists == skipped_track.artists and
                    track.album == skipped_track.album):
                    if track not in tracks_to_remove:
                        tracks_to_remove.append(track)
                    break
        
        if tracks_to_remove:
            for track in tracks_to_remove:
                if track in self.tracks:
                    self.tracks.remove(track)
                if track in self.all_tracks:
                    self.all_tracks.remove(track)
            
            self.update_track_list_display()
            successful_count = len([t for t in tracks_to_remove if t in successful_tracks])
            skipped_count = len([t for t in tracks_to_remove if t in skipped_tracks])
            
            message = f"Removed {len(tracks_to_remove)} tracks from the list"
            if successful_count > 0:
                message += f" ({successful_count} downloaded"
            if skipped_count > 0:
                message += f", {skipped_count} already existed" if successful_count > 0 else f" ({skipped_count} already existed"
            if successful_count > 0 or skipped_count > 0:
                message += ")"
            
            self.log_output.append(message + ".")
            self.tab_widget.setCurrentIndex(0)
        else:
            self.log_output.append("No matching tracks found in the current list.")
        
        self.remove_successful_btn.hide()

    def delete_tracks(self):
        if self.is_single_track:
            self.reset_state()
            self.reset_ui()
        else:
            selected_items = self.track_list.selectedItems()
            
            if not selected_items:
                reply = QMessageBox.question(
                    self,
                    'Confirm Delete All',
                    f'No tracks selected. Delete all {len(self.tracks)} tracks?',
                    QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                    QMessageBox.StandardButton.No
                )
                
                if reply == QMessageBox.StandardButton.Yes:
                    self.reset_state()
                    self.reset_ui()
            else:
                selected_indices = [self.track_list.row(item) for item in selected_items]
                tracks_to_remove = [self.tracks[i] for i in selected_indices]
                
                for track in tracks_to_remove:
                    if track in self.tracks:
                        self.tracks.remove(track)
                    if track in self.all_tracks:
                        self.all_tracks.remove(track)
                
                self.update_track_list_display()
        self.tab_widget.setCurrentIndex(0)

    def start_timer(self):
        self.elapsed_time = QTime(0, 0, 0)
        self.time_label.setText("00:00:00")
        self.time_label.show()
        self.timer.start(1000)
    
    def stop_timer(self):
        self.timer.stop()
        self.time_label.hide()

    def closeEvent(self, event):
        if hasattr(self, 'timer'):
            self.timer.stop()
        
        if hasattr(self, 'service_dropdown'):
            for attr_name in ['tidal_status_checker', 'deezer_status_checker']:
                if hasattr(self.service_dropdown, attr_name):
                    checker = getattr(self.service_dropdown, attr_name)
                    if checker.isRunning():
                        checker.quit()
                        checker.wait()
        
        if hasattr(self, 'worker') and self.worker and self.worker.isRunning():
            self.worker.stop()
            self.worker.quit()
            self.worker.wait()
        
        event.accept()

if __name__ == '__main__':
    try:
        if sys.platform == "win32":
            import io
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
            sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
    except Exception as e:
        pass
        
    app = QApplication(sys.argv)
    
    settings = QSettings('SpotiFLAC', 'Settings')
    theme_color = settings.value('theme_color', '#2196F3')
    
    qdarktheme.setup_theme(
        custom_colors={
            "[dark]": {
                "primary": theme_color,
            }
        }
    )
    ex = SpotiFLACGUI()
    ex.show()
    sys.exit(app.exec())