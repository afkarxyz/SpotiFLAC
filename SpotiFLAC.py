import sys
import os
from dataclasses import dataclass
from datetime import datetime
import requests
import re
import asyncio
from packaging import version

from PyQt6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QHBoxLayout, QPushButton, QLineEdit,
    QLabel, QFileDialog, QListWidget, QTextEdit, QTabWidget, QButtonGroup, QRadioButton,
    QAbstractItemView, QSpacerItem, QSizePolicy, QProgressBar, QCheckBox, QDialog,
    QDialogButtonBox, QComboBox, QStyledItemDelegate
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal, QUrl, QTimer, QTime, QSettings, QSize
from PyQt6.QtGui import QIcon, QTextCursor, QDesktopServices, QPixmap, QBrush
from PyQt6.QtNetwork import QNetworkAccessManager, QNetworkRequest, QNetworkReply

from getMetadata import get_filtered_data, parse_uri, SpotifyInvalidUrlException
from qobuzDL import QobuzDownloader
from tidalDL import TidalDownloader
from deezerDL import DeezerDownloader

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
                 use_album_subfolders=False, service="tidal", qobuz_region="us"):
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
            elif self.service == "tidal": 
                downloader = TidalDownloader()
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
                        
                        success = loop.run_until_complete(downloader.download_by_isrc(track.isrc, track_outpath))
                        
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
        self.services_status = {}
        
        self.setItemDelegate(StatusIndicatorDelegate())
        self.setup_items()
        
        self.tidal_status_checker = TidalStatusChecker()
        self.tidal_status_checker.status_updated.connect(self.update_tidal_service_status) 
        self.tidal_status_checker.error.connect(lambda e: print(f"Tidal status check error: {e}")) 
        self.tidal_status_checker.start()

        self.tidal_status_timer = QTimer(self)
        self.tidal_status_timer.timeout.connect(self.refresh_tidal_status) 
        self.tidal_status_timer.start(6000)
        
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
        
class SpotiFLACGUI(QWidget):
    def __init__(self):
        super().__init__()
        self.current_version = "4.1"
        self.tracks = []
        self.all_tracks = []  
        self.reset_state()
        
        self.settings = QSettings('SpotiFLAC', 'Settings')
        self.last_output_path = self.settings.value('output_path', os.path.expanduser("~\\Music"))
        self.last_url = self.settings.value('spotify_url', '')
        
        self.filename_format = self.settings.value('filename_format', 'title_artist')
        self.use_track_numbers = self.settings.value('use_track_numbers', False, type=bool)
        self.use_album_subfolders = self.settings.value('use_album_subfolders', False, type=bool)
        self.service = self.settings.value('service', 'tidal')
        self.qobuz_region = self.settings.value('qobuz_region', 'us')
        self.check_for_updates = self.settings.value('check_for_updates', True, type=bool)
        
        self.elapsed_time = QTime(0, 0, 0)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.update_timer)
        
        self.network_manager = QNetworkAccessManager()
        self.network_manager.finished.connect(self.on_cover_loaded)
        
        self.initUI()
        
        if self.check_for_updates:
            QTimer.singleShot(0, self.check_updates)

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
        self.all_tracks.clear()
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
        if hasattr(self, 'search_input'):
            self.search_input.clear()
        if hasattr(self, 'search_widget'):
            self.search_widget.hide()

    def initUI(self):
        self.setWindowTitle('SpotiFLAC')
        self.setFixedWidth(650)
        self.setMinimumHeight(350)  
        
        icon_path = os.path.join(os.path.dirname(__file__), "icon.svg")
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
        self.spotify_url.setPlaceholderText("Please enter the Spotify URL")
        self.spotify_url.setClearButtonEnabled(True)
        self.spotify_url.setText(self.last_url)
        self.spotify_url.textChanged.connect(self.save_url)
        
        self.fetch_btn = QPushButton('Fetch')
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
        dashboard_layout.addWidget(self.track_list)
        
        self.setup_track_buttons()
        dashboard_layout.addLayout(self.btn_layout)

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
        self.download_selected_btn = QPushButton('Download Selected')
        self.download_all_btn = QPushButton('Download All')
        self.remove_btn = QPushButton('Remove Selected')
        self.clear_btn = QPushButton('Clear')
        
        for btn in [self.download_selected_btn, self.download_all_btn, self.remove_btn, self.clear_btn]:
            btn.setFixedWidth(150)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            
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
        progress_time_layout.addWidget(self.progress_bar)
        
        self.time_label = QLabel("00:00:00")
        self.time_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        progress_time_layout.addWidget(self.time_label)
        
        process_layout.addLayout(progress_time_layout)
        
        control_layout = QHBoxLayout()
        self.stop_btn = QPushButton('Stop')
        self.pause_resume_btn = QPushButton('Pause')
        
        self.stop_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self.pause_resume_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        
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
        
        self.output_browse = QPushButton('Browse')
        self.output_browse.setCursor(Qt.CursorShape.PointingHandCursor)
        self.output_browse.clicked.connect(self.browse_output)
        
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
            button.setStyleSheet("""
                QPushButton {
                    background-color: palette(button);
                    color: palette(button-text);
                    border: 1px solid palette(mid);
                    padding: 6px;
                    border-radius: 15px;
                }
                QPushButton:hover {
                    background-color: palette(light);
                }
                QPushButton:pressed {
                    background-color: palette(midlight);
                }
            """)
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.clicked.connect(lambda _, url=url: QDesktopServices.openUrl(QUrl(url if url.startswith(('http://', 'https://')) else f'https://{url}')))
            section_layout.addWidget(button, alignment=Qt.AlignmentFlag.AlignCenter)

            about_layout.addWidget(section_widget)
            
            if sections.index((title, url)) < len(sections) - 1:
                spacer = QSpacerItem(20, 6, QSizePolicy.Policy.Minimum, QSizePolicy.Policy.Fixed)
                about_layout.addItem(spacer)

        footer_label = QLabel("v4.1 | July 2025")
        footer_label.setStyleSheet("font-size: 12px; margin-top: 10px;")
        about_layout.addWidget(footer_label, alignment=Qt.AlignmentFlag.AlignCenter)

        about_tab.setLayout(about_layout)
        self.tab_widget.addTab(about_tab, "About")    
    def on_service_changed(self, index):
        service = self.service_dropdown.currentData()
        self.service = service
        self.settings.setValue('service', service)
        self.settings.sync()
        
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
        elif service == "deezer":
            if region_label:
                region_label.hide()
            self.qobuz_region_dropdown.hide()
        else:
            if region_label:
                region_label.hide()
            self.qobuz_region_dropdown.hide()

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
        self.log_output.append(f"Qobuz region setting saved: {self.qobuz_region_dropdown.currentText()}")
    

    
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
        track_id = track_data["external_urls"].split("/")[-1]
        
        track = Track(
            external_urls=track_data["external_urls"],
            title=track_data["name"],
            artists=track_data["artists"],
            album=track_data["album_name"],
            track_number=1,
            duration_ms=track_data.get("duration_ms", 0),
            id=track_id,
            isrc=track_data.get("isrc", "")
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
                isrc=track.get("isrc", "")
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
                track_number=len(self.tracks) + 1,
                duration_ms=track.get("duration_ms", 0),
                id=track_id,
                isrc=track.get("isrc", "")
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
            selected_indices = [self.track_list.row(item) for item in selected_items]
            self.download_tracks(selected_indices)

    def download_all(self):
        if self.is_single_track:
            self.download_tracks([0])
        else:
            self.download_tracks(range(len(self.tracks)))

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
            qobuz_region
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
    app.setStyle('fusion')
    ex = SpotiFLACGUI()
    ex.show()
    sys.exit(app.exec())
