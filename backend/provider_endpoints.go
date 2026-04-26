package backend

const amazonMusicAPIBaseURL = "https://amazon.spotbye.qzz.io"
const qobuzMusicDLDownloadAPIURL = "https://www.musicdl.me/api/qobuz/download"

var defaultQobuzStreamAPIBaseURLs = []string{
	"https://dab.yeet.su/api/stream?trackId=",
	"https://dabmusic.xyz/api/stream?trackId=",
}

func GetQobuzStreamAPIBaseURLs() []string {
	return append([]string(nil), defaultQobuzStreamAPIBaseURLs...)
}

func GetQobuzMusicDLDownloadAPIURL() string {
	return qobuzMusicDLDownloadAPIURL
}

func GetAmazonMusicAPIBaseURL() string {
	return amazonMusicAPIBaseURL
}
