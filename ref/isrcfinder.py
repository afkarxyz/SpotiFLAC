import requests
import re
from bs4 import BeautifulSoup

URL = "https://www.isrcfinder.com/"
SPOTIFY_URI = "https://open.spotify.com/track/1CPZ5BxNNd0n0nF4Orb9JS"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://www.isrcfinder.com/",
    "Origin": "https://www.isrcfinder.com",
}

# ─────────────────────────────────────────────
# PRIMARY: isrcfinder.com
# ─────────────────────────────────────────────

def get_csrf_token(session):
    """Ambil CSRF token secara dinamis dari halaman GET."""
    print("[*] Mengambil CSRF token dari halaman...")
    response = session.get(URL, headers=HEADERS)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    csrf_input = soup.find("input", {"name": "csrfmiddlewaretoken"})
    if csrf_input:
        token = csrf_input["value"]
        print(f"    CSRF token (HTML)  : {token}")
        return token

    token = session.cookies.get("csrftoken")
    if token:
        print(f"    CSRF token (cookie): {token}")
        return token

    raise ValueError("CSRF token tidak ditemukan!")


def find_isrc_primary(session, csrf_token):
    """Kirim POST request ke isrcfinder.com dan ekstrak ISRC."""
    print(f"\n[*] [PRIMARY] isrcfinder.com — URI: {SPOTIFY_URI}")

    headers = {
        **HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
    }
    payload = {
        "csrfmiddlewaretoken": csrf_token,
        "URI": SPOTIFY_URI,
    }

    response = session.post(URL, headers=headers, data=payload)
    print(f"    Status POST : {response.status_code}")
    print(f"    URL akhir   : {response.url}")

    isrc_pattern = re.compile(r'[A-Z]{2}[A-Z0-9]{3}\d{7}')
    isrc_matches = list(set(isrc_pattern.findall(response.text)))

    if isrc_matches:
        print(f"[+] [PRIMARY] ISRC ditemukan: {isrc_matches}")
    else:
        print("[-] [PRIMARY] ISRC tidak ditemukan.")

    return isrc_matches


# ─────────────────────────────────────────────
# FALLBACK 1: phpstack (Cloudways)
# ─────────────────────────────────────────────

def find_isrc_fallback1():
    """
    GET https://phpstack-822472-6184058.cloudwaysapps.com/api/spotify.php
    Response JSON: { "isrc": "...", "name": "...", ... }
    """
    print("\n[*] [FALLBACK 1] phpstack Cloudways API...")

    encoded_uri = requests.utils.quote(SPOTIFY_URI, safe="")
    url = f"https://phpstack-822472-6184058.cloudwaysapps.com/api/spotify.php?q={encoded_uri}"

    headers = {
        "User-Agent": HEADERS["User-Agent"],
        "Referer": "https://phpstack-822472-6184058.cloudwaysapps.com/?",
    }

    try:
        response = requests.get(url, headers=headers, timeout=10)
        print(f"    Status GET : {response.status_code}")
        data = response.json()

        isrc = data.get("isrc")
        if isrc:
            print(f"[+] [FALLBACK 1] ISRC ditemukan: {isrc}")
            return [isrc]

        print(f"[-] [FALLBACK 1] ISRC tidak ada di response: {data}")
        return []

    except Exception as e:
        print(f"[!] [FALLBACK 1] Error: {e}")
        return []


# ─────────────────────────────────────────────
# FALLBACK 2: findmyisrc.com (AWS API Gateway)
# ─────────────────────────────────────────────

def find_isrc_fallback2():
    """
    POST https://lxtzsnh4l3.execute-api.ap-southeast-2.amazonaws.com/prod/find-my-isrc
    Payload: { "uris": ["<spotify_url>"] }
    Response: [{ "type": "track", "data": { "isrc": "..." } }]
    """
    print("\n[*] [FALLBACK 2] findmyisrc.com (AWS API Gateway)...")

    url = "https://lxtzsnh4l3.execute-api.ap-southeast-2.amazonaws.com/prod/find-my-isrc"
    headers = {
        "User-Agent": HEADERS["User-Agent"],
        "Content-Type": "application/json",
        "Origin": "https://www.findmyisrc.com",
        "Referer": "https://www.findmyisrc.com/",
    }
    payload = {"uris": [SPOTIFY_URI]}

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        print(f"    Status POST : {response.status_code}")
        data = response.json()

        isrc_list = []
        for item in data:
            isrc = item.get("data", {}).get("isrc")
            if isrc:
                isrc_list.append(isrc)

        if isrc_list:
            print(f"[+] [FALLBACK 2] ISRC ditemukan: {isrc_list}")
        else:
            print(f"[-] [FALLBACK 2] ISRC tidak ada di response: {data}")

        return isrc_list

    except Exception as e:
        print(f"[!] [FALLBACK 2] Error: {e}")
        return []


# ─────────────────────────────────────────────
# FALLBACK 3: mixviberecords.com
# ─────────────────────────────────────────────

def find_isrc_fallback3():
    """
    POST https://tools.mixviberecords.com/api/find-isrc
    Payload: { "url": "<spotify_url>" }
    Response JSON contains: { "external_ids": { "isrc": "..." } }
    """
    print("\n[*] [FALLBACK 3] mixviberecords.com...")

    url = "https://tools.mixviberecords.com/api/find-isrc"
    headers = {
        "User-Agent": HEADERS["User-Agent"],
        "Content-Type": "application/json",
        "Origin": "https://tools.mixviberecords.com",
        "Referer": "https://tools.mixviberecords.com/isrc-finder",
    }
    payload = {"url": SPOTIFY_URI}

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)
        print(f"    Status POST : {response.status_code}")
        data = response.json()

        # Navigasi ke external_ids.isrc (bisa nested dalam berbagai struktur)
        isrc = None
        if isinstance(data, dict):
            isrc = (
                data.get("external_ids", {}).get("isrc")
                or data.get("isrc")
            )
            # Coba cari rekursif satu level lebih dalam
            if not isrc:
                for val in data.values():
                    if isinstance(val, dict):
                        isrc = val.get("external_ids", {}).get("isrc") or val.get("isrc")
                        if isrc:
                            break

        if not isrc:
            # Fallback regex pada raw text jika JSON tidak sesuai ekspektasi
            isrc_pattern = re.compile(r'[A-Z]{2}[A-Z0-9]{3}\d{7}')
            matches = list(set(isrc_pattern.findall(response.text)))
            if matches:
                isrc = matches[0]

        if isrc:
            print(f"[+] [FALLBACK 3] ISRC ditemukan: {isrc}")
            return [isrc]

        print(f"[-] [FALLBACK 3] ISRC tidak ada di response: {data}")
        return []

    except Exception as e:
        print(f"[!] [FALLBACK 3] Error: {e}")
        return []


# ─────────────────────────────────────────────
# MAIN — jalankan berurutan, berhenti jika berhasil
# ─────────────────────────────────────────────

def main():
    isrc_list = []

    # PRIMARY
    with requests.Session() as session:
        try:
            csrf_token = get_csrf_token(session)
            isrc_list = find_isrc_primary(session, csrf_token)
        except Exception as e:
            print(f"[!] [PRIMARY] Gagal: {e}")

    # FALLBACK 1
    if not isrc_list:
        isrc_list = find_isrc_fallback1()

    # FALLBACK 2
    if not isrc_list:
        isrc_list = find_isrc_fallback2()

    # FALLBACK 3
    if not isrc_list:
        isrc_list = find_isrc_fallback3()

    # Hasil akhir
    print(f"\n{'='*40}")
    if isrc_list:
        print(f"  Hasil ISRC: {', '.join(isrc_list)}")
    else:
        print("  Semua sumber gagal. ISRC tidak ditemukan.")
    print(f"{'='*40}")


if __name__ == "__main__":
    main()