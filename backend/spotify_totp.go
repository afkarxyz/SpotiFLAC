package backend

import (
	"fmt"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
)

const (
	spotifyTOTPSecret  = "GM3TMMJTGYZTQNZVGM4DINJZHA4TGOBYGMZTCMRTGEYDSMJRHE4TEOBUG4YTCMRUGQ4DQOJUGQYTAMRRGA2TCMJSHE3TCMBY"
	spotifyTOTPVersion = 61
)

func generateSpotifyTOTP(now time.Time) (string, int, error) {
	key, err := otp.NewKeyFromURL(fmt.Sprintf("otpauth://totp/secret?secret=%s", spotifyTOTPSecret))
	if err != nil {
		return "", 0, err
	}

	code, err := totp.GenerateCode(key.Secret(), now)
	if err != nil {
		return "", 0, err
	}

	return code, spotifyTOTPVersion, nil
}
