import requests
import re
import json
from bs4 import BeautifulSoup

ISRCFINDER_URL = "https://www.isrcfinder.com/"
SONGSTATS_BASE = "https://songstats.com"
SPOTIFY_URI    = "https://open.spotify.com/track/1CPZ5BxNNd0n0nF4Orb9JS"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.isrcfinder.com/",
    "Origin": "https://www.isrcfinder.com",
}

def get_csrf_token(session):
    print("[1] Mengambil CSRF token ...")
    response = session.get(ISRCFINDER_URL, headers=HEADERS)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    csrf_input = soup.find("input", {"name": "csrfmiddlewaretoken"})
    if csrf_input:
        token = csrf_input["value"]
        print(f"    Token : {token}")
        return token

    token = session.cookies.get("csrftoken")
    if token:
        print(f"    Token : {token}")
        return token

    raise ValueError("CSRF token tidak ditemukan!")

def get_isrc(session, csrf_token):
    print(f"\n[2] Mencari ISRC untuk: {SPOTIFY_URI}")
    headers = {**HEADERS, "Content-Type": "application/x-www-form-urlencoded"}
    payload = {"csrfmiddlewaretoken": csrf_token, "URI": SPOTIFY_URI}

    response = session.post(ISRCFINDER_URL, headers=headers, data=payload)
    matches = list(set(re.findall(r'\b([A-Z]{2}[A-Z0-9]{3}\d{7})\b', response.text)))

    if not matches:
        raise ValueError("ISRC tidak ditemukan di response.")

    isrc = matches[0]
    print(f"    ISRC  : {isrc}")
    return isrc

def get_platform_links(session, isrc):
    url = f"{SONGSTATS_BASE}/{isrc}?ref=ISRCFinder"
    print(f"\n[3] Mengambil link dari songstats.com ...")

    response = session.get(url, headers={"User-Agent": HEADERS["User-Agent"]}, allow_redirects=True)
    soup = BeautifulSoup(response.text, "html.parser")

    tidal_link  = None
    amazon_link = None
    deezer_link = None

    for script in soup.find_all("script", {"type": "application/ld+json"}):
        try:
            data  = json.loads(script.string)
            graph = data.get("@graph", [data])

            for node in graph:
                if node.get("@type") == "MusicRecording":
                    for link in node.get("sameAs", []):
                        if "listen.tidal.com/track" in link:
                            tidal_link = link
                        elif "music.amazon.com" in link:
                            amazon_link = link
                        elif "deezer.com" in link:
                            deezer_link = link
        except (json.JSONDecodeError, AttributeError):
            continue

    return tidal_link, amazon_link, deezer_link

def main():
    with requests.Session() as session:
        csrf_token              = get_csrf_token(session)
        isrc                    = get_isrc(session, csrf_token)
        tidal, amazon, deezer   = get_platform_links(session, isrc)

        print(f"\n{'='*50}")
        print(f"  ISRC         : {isrc}")
        print(f"  Tidal        : {tidal  or 'Tidak ditemukan'}")
        print(f"  Amazon Music : {amazon or 'Tidak ditemukan'}")
        print(f"  Deezer       : {deezer or 'Tidak ditemukan'}")
        print(f"{'='*50}")

if __name__ == "__main__":
    main()