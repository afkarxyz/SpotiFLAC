package backend

const amazonMusicAPIBaseURL = "https://amazon.spotbye.qzz.io"

var defaultQobuzStreamAPIBaseURLs = []string{
	"https://dab.yeet.su/api/stream?trackId=",
	"https://dabmusic.xyz/api/stream?trackId=",
	"https://qobuz.spotbye.qzz.io/api/track/",
}

func GetQobuzStreamAPIBaseURLs() []string {
	return append([]string(nil), defaultQobuzStreamAPIBaseURLs...)
}

func GetAmazonMusicAPIBaseURL() string {
	return amazonMusicAPIBaseURL
}
