import os
import re
import time
import base64
import requests
import json
from mutagen.flac import FLAC, Picture
from mutagen.id3 import PictureType

class ProgressCallback:
    def __call__(self, current, total):
        if total > 0:
            percent = (current / total) * 100
            print(f"\r{percent:.2f}% ({current}/{total})", end="")
        else:
            print(f"\r{current / (1024 * 1024):.2f} MB", end="")

class TidalDownloader:
    def __init__(self, timeout=30, max_retries=3, api_url=None):
        self.timeout = timeout
        self.max_retries = max_retries
        self.download_chunk_size = 256 * 1024
        self.progress_callback = ProgressCallback()
        self.client_id = base64.b64decode("NkJEU1JkcEs5aHFFQlRnVQ==").decode()
        self.client_secret = base64.b64decode("eGV1UG1ZN25icFo5SUliTEFjUTkzc2hrYTFWTmhlVUFxTjZJY3N6alRHOD0=").decode()
        self.api_url = api_url or "https://hifi.401658.xyz"
    
    @staticmethod
    def get_available_apis():
        try:
            response = requests.get("https://status.monochrome.tf/api/stream", timeout=10, stream=True)
            
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        data = json.loads(line_str[6:])
                        
                        api_instances = [
                            inst for inst in data.get('instances', [])
                            if inst.get('instance_type') == 'api' and inst.get('last_check', {}).get('success')
                        ]
                        
                        api_instances.sort(key=lambda x: x.get('avg_response_time', 9999))
                        
                        return api_instances
                        
        except Exception as e:
            print(f"Failed to fetch API list: {e}")
            return []
    
    @staticmethod
    def select_api_interactive():
        apis = TidalDownloader.get_available_apis()
        
        if not apis:
            print("No APIs available, using default: https://hifi.401658.xyz")
            return "https://hifi.401658.xyz"
        
        print("\n=== Available API Instances ===")
        print(f"{'No':<4} {'URL':<40} {'Status':<8} {'Uptime':<8} {'Avg Response':<12}")
        print("-" * 80)
        
        for i, api in enumerate(apis, 1):
            url = api.get('url', 'N/A')
            status = "UP" if api.get('last_check', {}).get('success') else "DOWN"
            uptime = f"{api.get('uptime', 0):.1f}%"
            avg_time = f"{api.get('avg_response_time', 0)}ms"
            
            print(f"{i:<4} {url:<40} {status:<8} {uptime:<8} {avg_time:<12}")
        
        print("\n0    Use default (https://hifi.401658.xyz)")
        print("-" * 80)
        
        while True:
            try:
                choice = input(f"\nSelect API (0-{len(apis)}) [1 for fastest]: ").strip()
                
                if not choice:
                    choice = "1"
                
                choice_num = int(choice)
                
                if choice_num == 0:
                    return "https://hifi.401658.xyz"
                elif 1 <= choice_num <= len(apis):
                    selected_url = apis[choice_num - 1]['url']
                    print(f"\nSelected: {selected_url}")
                    return selected_url
                else:
                    print(f"Invalid choice. Please enter 0-{len(apis)}")
            except ValueError:
                print("Invalid input. Please enter a number.")
            except KeyboardInterrupt:
                print("\nUsing default API")
                return "https://hifi.401658.xyz"

    def set_progress_callback(self, callback):
        self.progress_callback = callback

    def sanitize_filename(self, filename):
        if not filename: 
            return "Unknown Track"
        sanitized = re.sub(r'[\\/*?:"<>|]', "", str(filename))
        return re.sub(r'\s+', ' ', sanitized).strip() or "Unnamed Track"

    def get_access_token(self):
        refresh_url = "https://auth.tidal.com/v1/oauth2/token"
        
        payload = {
            "client_id": self.client_id,
            "grant_type": "client_credentials",
        }
        
        try:
            response = requests.post(
                url=refresh_url,
                data=payload,
                auth=(self.client_id, self.client_secret),
                timeout=self.timeout
            )
            
            if response.status_code == 200:
                token_data = response.json()
                return token_data.get("access_token")
            else:
                return None
                
        except:
            return None

    def search_tracks(self, query):
        try:
            tidal_token = self.get_access_token()
            if not tidal_token:
                raise Exception("Failed to get access token")

            search_url = f"https://api.tidal.com/v1/search/tracks?query={query}&limit=25&offset=0&countryCode=US"
            header = {"authorization": f"Bearer {tidal_token}"}

            search_data = requests.get(url=search_url, headers=header, timeout=self.timeout)
            response_data = search_data.json()
            
            filtered_items = [{
                "id": item.get("id"),
                "title": item.get("title"),
                "url": item.get("url"),
                "isrc": item.get("isrc"),
                "audioQuality": item.get("audioQuality"),
                "mediaMetadata": item.get("mediaMetadata"),
                "album": item.get("album", {}),
                "artists": item.get("artists", []),
                "artist": item.get("artist", {}),
                "trackNumber": item.get("trackNumber"),
                "volumeNumber": item.get("volumeNumber"),
                "duration": item.get("duration"),
                "copyright": item.get("copyright"),
                "explicit": item.get("explicit")
            } for item in response_data.get("items", [])]
            
            return {
                "limit": response_data.get("limit"),
                "offset": response_data.get("offset"),
                "totalNumberOfItems": response_data.get("totalNumberOfItems"),
                "items": filtered_items
            }

        except Exception as e:
            raise Exception(f"Search error: {str(e)}")

    def get_track_info(self, query, isrc=None):
        print(f"Fetching: {query}" + (f" (ISRC: {isrc})" if isrc else ""))
        
        try:
            result = self.search_tracks(query)
            
            if not result or not result.get("items"):
                raise Exception(f"No tracks found for query: {query}")
            
            selected_track = None
            if isrc:
                isrc_items = [item for item in result["items"] if item.get("isrc") == isrc]
                
                if len(isrc_items) > 1:
                    hires_items = []
                    for item in isrc_items:
                        media_metadata = item.get("mediaMetadata", {})
                        tags = media_metadata.get("tags", []) if media_metadata else []
                        if "HIRES_LOSSLESS" in tags:
                            hires_items.append(item)
                    
                    if hires_items:
                        selected_track = hires_items[0]
                    else:
                        selected_track = isrc_items[0]
                elif len(isrc_items) == 1:
                    selected_track = isrc_items[0]
                else:
                    selected_track = result["items"][0]
            else:
                selected_track = result["items"][0]
                
            if not selected_track:
                raise Exception(f"Track not found: {query}" + (f" (ISRC: {isrc})" if isrc else ""))
                
            title = selected_track.get('title', 'Unknown')
            quality = selected_track.get('audioQuality', 'Unknown')
            print(f"Found: {title} ({quality})")
            return selected_track
            
        except Exception as e:
            raise Exception(f"Error getting track info: {str(e)}")

    def get_download_url(self, track_id, quality="LOSSLESS"):
        print("Fetching URL...")
        download_api_url = f"{self.api_url}/track/?id={track_id}&quality={quality}"
        
        try:
            response = requests.get(download_api_url, timeout=self.timeout)
            
            if response.status_code == 200:
                data = response.json()
                
                for item in data:
                    if "OriginalTrackUrl" in item:
                        print("URL found")
                        return {
                            "download_url": item["OriginalTrackUrl"],
                            "track_info": data[0] if data else {}
                        }
                
                raise Exception("Download URL not found in response")
            else:
                raise Exception(f"API returned status code: {response.status_code}")
                
        except Exception as e:
            raise Exception(f"Error getting download URL: {str(e)}")

    def download_album_art(self, album_id, size="1280x1280"):
        try:
            art_url = f"https://resources.tidal.com/images/{album_id.replace('-', '/')}/{size}.jpg"
            
            response = requests.get(art_url, timeout=self.timeout)
            
            if response.status_code == 200:
                return response.content
            else:
                print(f"Failed to download album art: HTTP {response.status_code}")
                return None
                
        except Exception as e:
            print(f"Error downloading album art: {str(e)}")
            return None

    def download_file(self, url, filepath, is_paused_callback=None, is_stopped_callback=None):
        file_dir = os.path.dirname(filepath)
        if file_dir and not os.path.exists(file_dir):
            os.makedirs(file_dir, exist_ok=True)
        
        temp_filepath = filepath + ".part"
        retry_count = 0
        
        while retry_count <= self.max_retries:
            try:
                response = requests.get(url, timeout=60.0)
                if response.status_code != 200:
                    raise Exception(f"HTTP {response.status_code}")
                
                if is_stopped_callback and is_stopped_callback():
                    raise Exception("Download stopped")
                    
                while is_paused_callback and is_paused_callback():
                    time.sleep(0.1)
                    if is_stopped_callback and is_stopped_callback():
                        raise Exception("Download stopped")
                
                with open(temp_filepath, 'wb') as f:
                    f.write(response.content)
                
                downloaded_size = len(response.content)
                
                if self.progress_callback:
                    self.progress_callback(downloaded_size, downloaded_size)
                    
                os.rename(temp_filepath, filepath)
                print("Download complete")
                return {"success": True, "size": downloaded_size}
                
            except Exception as e:
                retry_count += 1
                if retry_count > self.max_retries:
                    if os.path.exists(temp_filepath):
                        try:
                            os.remove(temp_filepath)
                        except:
                            pass
                    raise Exception(f"Download error after {self.max_retries} retries: {str(e)}")
                
                print(f"Download error (attempt {retry_count}/{self.max_retries}): {str(e)}")
                print(f"Retrying in {retry_count * 2} seconds...")
                time.sleep(retry_count * 2)

    def embed_metadata(self, filepath, track_info, search_info=None):
        try:
            print("Embedding metadata...")
            audio = FLAC(filepath)
            audio.clear()
            audio.clear_pictures()
            
            if track_info.get("title"):
                audio["TITLE"] = track_info["title"]
            
            artists_list = []
            if search_info and search_info.get("artists"):
                for artist in search_info["artists"]:
                    if artist.get("name"):
                        artists_list.append(artist["name"])
            elif search_info and search_info.get("artist") and search_info["artist"].get("name"):
                artists_list.append(search_info["artist"]["name"])
            elif track_info.get("artists"):
                for artist in track_info["artists"]:
                    if artist.get("name"):
                        artists_list.append(artist["name"])
            elif track_info.get("artist") and track_info["artist"].get("name"):
                artists_list.append(track_info["artist"]["name"])
            
            if artists_list:
                audio["ARTIST"] = artists_list[0]  
                if len(artists_list) > 1:
                    audio["ALBUMARTIST"] = "; ".join(artists_list)
                else:
                    audio["ALBUMARTIST"] = artists_list[0]
            
            album_info = search_info.get("album", {}) if search_info else track_info.get("album", {})
            if album_info.get("title"):
                audio["ALBUM"] = album_info["title"]
            
            if search_info and search_info.get("trackNumber"):
                audio["TRACKNUMBER"] = str(search_info["trackNumber"])
            elif track_info.get("trackNumber"):
                audio["TRACKNUMBER"] = str(track_info["trackNumber"])
            
            if search_info and search_info.get("volumeNumber"):
                audio["DISCNUMBER"] = str(search_info["volumeNumber"])
            elif track_info.get("volumeNumber"):
                audio["DISCNUMBER"] = str(track_info["volumeNumber"])
            
            duration = search_info.get("duration") if search_info else track_info.get("duration")
            if duration:
                audio["LENGTH"] = str(duration)
            
            isrc = search_info.get("isrc") if search_info else track_info.get("isrc")
            if isrc:
                audio["ISRC"] = isrc
            
            copyright_info = search_info.get("copyright") if search_info else track_info.get("copyright")
            if copyright_info:
                audio["COPYRIGHT"] = copyright_info
            
            if album_info.get("releaseDate"):
                audio["DATE"] = album_info["releaseDate"][:4]
                try:
                    audio["YEAR"] = album_info["releaseDate"][:4]
                except:
                    pass
            
            if track_info.get("genre"):
                audio["GENRE"] = track_info["genre"]
            
            if track_info.get("audioQuality"):
                audio["COMMENT"] = f"Tidal {track_info['audioQuality']}"
            
            if album_info.get("cover"):
                album_art = self.download_album_art(album_info["cover"])
                if album_art:
                    picture = Picture()
                    picture.data = album_art
                    picture.type = PictureType.COVER_FRONT
                    picture.mime = "image/jpeg"
                    picture.desc = "Cover"
                    audio.add_picture(picture)
                    print("Album art embedded")
            
            audio.save()
            print(f"Metadata embedded successfully for: {track_info.get('title', 'Unknown')}")
            return True
            
        except Exception as e:
            print(f"Error embedding metadata: {str(e)}")
            return False

    def download(self, query, isrc=None, output_dir=".", quality="LOSSLESS", is_paused_callback=None, is_stopped_callback=None, auto_fallback=False):
        if output_dir != ".":
            try:
                os.makedirs(output_dir, exist_ok=True)
            except OSError as e:
                raise Exception(f"Directory error: {e}")
        
        if auto_fallback:
            apis = self.get_available_apis()
            if not apis:
                print("No APIs available for fallback, using current API")
                return self._download_single(query, isrc, output_dir, quality, is_paused_callback, is_stopped_callback)
            
            last_error = None
            for i, api in enumerate(apis, 1):
                api_url = api.get('url')
                try:
                    print(f"[Auto Fallback {i}/{len(apis)}] Trying: {api_url}")
                    
                    fallback_downloader = TidalDownloader(api_url=api_url)
                    fallback_downloader.set_progress_callback(self.progress_callback)
                    
                    result = fallback_downloader._download_single(
                        query, isrc, output_dir, quality, 
                        is_paused_callback, is_stopped_callback
                    )
                    
                    print(f"✓ Success with: {api_url}")
                    return result
                    
                except Exception as e:
                    last_error = str(e)
                    print(f"✗ Failed with {api_url}: {last_error[:80]}")
                    continue
            
            raise Exception(f"All {len(apis)} APIs failed. Last error: {last_error}")
        
        return self._download_single(query, isrc, output_dir, quality, is_paused_callback, is_stopped_callback)
    
    def _download_single(self, query, isrc, output_dir, quality, is_paused_callback, is_stopped_callback):
        track_info = self.get_track_info(query, isrc)
        track_id = track_info.get("id")
        
        if not track_id:
            raise Exception("No track ID found")
        
        artists_list = []
        if track_info.get("artists"):
            for artist in track_info["artists"]:
                if artist.get("name"):
                    artists_list.append(artist["name"])
        elif track_info.get("artist") and track_info["artist"].get("name"):
            artists_list.append(track_info["artist"]["name"])
        
        artist_name = ", ".join(artists_list) if artists_list else "Unknown Artist"
        artist_name = self.sanitize_filename(artist_name)
        track_title = self.sanitize_filename(track_info.get("title", f"track_{track_id}"))
        
        output_filename = os.path.join(output_dir, f"{artist_name} - {track_title}.flac")
        
        if os.path.exists(output_filename):
            file_size = os.path.getsize(output_filename)
            if file_size > 0:
                print(f"File already exists: {output_filename} ({file_size / (1024 * 1024):.2f} MB)")
                return output_filename
        
        download_info = self.get_download_url(track_id, quality)
        download_url = download_info["download_url"]
        download_track_info = download_info["track_info"]
        
        print(f"Downloading to: {output_filename}")
        self.download_file(
            download_url, 
            output_filename, 
            is_paused_callback=is_paused_callback, 
            is_stopped_callback=is_stopped_callback
        )
        
        print("Adding metadata...")
        try:
            self.embed_metadata(output_filename, download_track_info, track_info)
            print("Metadata saved")
        except Exception as e:
            print(f"Tagging failed: {e}")
        
        print("Done")
        return output_filename

def main():
    print("=== TidalDL - Tidal Downloader ===")
    
    selected_api = TidalDownloader.select_api_interactive()
    downloader = TidalDownloader(timeout=30, max_retries=3, api_url=selected_api)
    
    query = "APT."
    isrc = "USAT22409172"
    output_dir = "."
    
    try:
        downloaded_file = downloader.download(query, isrc, output_dir)
        print(f"Success: File saved as {downloaded_file}")
    except Exception as e:
        print(f"Error: {str(e)}")

if __name__ == "__main__":
    try:
        import sys
        if sys.platform == "win32":
            import os
            os.system("chcp 65001 > nul")
            try:
                sys.stdout.reconfigure(encoding='utf-8')
            except:
                pass
    except:
        pass
        
    main()