//go:build !darwin

package backend

func SetMacOSFileIconFromImage(filePath, imagePath string, iconSize int) error {
	return nil
}
