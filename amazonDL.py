import requests
import time
import os
import re
import base64
import urllib3
from urllib.parse import unquote
from random import randrange

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

def get_random_user_agent():
    return f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_{randrange(11, 15)}_{randrange(4, 9)}) AppleWebKit/{randrange(530, 537)}.{randrange(30, 37)} (KHTML, like Gecko) Chrome/{randrange(80, 105)}.0.{randrange(3000, 4500)}.{randrange(60, 125)} Safari/{randrange(530, 537)}.{randrange(30, 36)}"

def extract_data(html, patterns):
    for pattern in patterns:
        if match := re.search(pattern, html):
            return match.group(1)
    return None

def download_track(track_id, service="amazon", output_dir="."):
    client = requests.Session()
    client.verify = False
    headers = {'User-Agent': get_random_user_agent()}
    
    try:
        spotify_url = f"https://open.spotify.com/track/{track_id}"
        params = {"url": spotify_url, "country": "auto", "to": service}
        
        response = client.get("https://lucida.to", params=params, headers=headers, timeout=30)
        html = response.text
        
        token = extract_data(html, [r'token:"([^"]+)"', r'"token"\s*:\s*"([^"]+)"'])
        url = extract_data(html, [r'"url":"([^"]+)"', r'url:"([^"]+)"'])
        expiry = extract_data(html, [r'tokenExpiry:(\d+)', r'"tokenExpiry"\s*:\s*(\d+)'])
        
        if not (token and url):
            raise Exception("Could not extract required data")
        
        try:
            decoded_token = base64.b64decode(base64.b64decode(token).decode('latin1')).decode('latin1')
        except:
            decoded_token = token
        
        clean_url = url.replace('\\/', '/')
        print(f"Fetching: {clean_url}")
        
        request_data = {
            "account": {"id": "auto", "type": "country"},
            "compat": "false", "downscale": "original", "handoff": True,
            "metadata": True, "private": True,
            "token": {"primary": decoded_token, "expiry": int(expiry) if expiry else None},
            "upload": {"enabled": False, "service": "pixeldrain"},
            "url": clean_url
        }

        response = client.post("https://lucida.to/api/load?url=/api/fetch/stream/v2", 
                              json=request_data, headers=headers)
        
        if csrf_token := response.cookies.get('csrf_token'):
            headers['X-CSRF-Token'] = csrf_token

        data = response.json()
        if not data.get("success"):
            raise Exception(f"Request failed: {data.get('error', 'Unknown error')}")

        completion_url = f"https://{data['server']}.lucida.to/api/fetch/request/{data['handoff']}"
        print("Fetching URL...")
        
        while True:
            resp = client.get(completion_url, headers=headers).json()
            if resp["status"] == "completed":
                print("URL found")
                break
            elif resp["status"] == "error":
                raise Exception(f"Processing failed: {resp.get('message', 'Unknown error')}")
            elif progress := resp.get("progress"):
                percent = int((progress.get("current", 0) / progress.get("total", 100)) * 100)
                print(f"\r{percent}%", end="")
            time.sleep(1)

        download_url = f"https://{data['server']}.lucida.to/api/fetch/request/{data['handoff']}/download"
        response = client.get(download_url, stream=True, headers=headers)
        
        file_name = "track.flac"
        if content_disp := response.headers.get('content-disposition'):
            if match := re.search(r'filename[*]?=([^;]+)', content_disp):
                raw_name = match.group(1).strip('"\'')
                file_name = unquote(raw_name[7:] if raw_name.startswith("UTF-8''") else raw_name)
                for char in '<>:"/\\|?*':
                    file_name = file_name.replace(char, '')
                file_name = file_name.strip()
        
        file_path = os.path.join(output_dir, file_name)
        print(f"Downloading...")
        
        with open(file_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        print("Download complete")
        print("Done")
        return file_path
        
    except Exception as e:
        print(f"Error: {str(e)}")
        return None

class LucidaDownloader:
    def __init__(self):
        self.progress_callback = None
    
    def set_progress_callback(self, callback):
        self.progress_callback = callback
    
    def download(self, track_id, output_dir, is_paused_callback=None, is_stopped_callback=None):
        try:
            return download_track(track_id, service="amazon", output_dir=output_dir)
        except Exception as e:
            raise Exception(f"Amazon Music download failed: {str(e)}")

if __name__ == "__main__":
    print("=== AmazonDL - Amazon Music Downloader ===")
    track_id = "2plbrEY59IikOBgBGLjaoe"
    service = "amazon"
    
    download_track(track_id, service)