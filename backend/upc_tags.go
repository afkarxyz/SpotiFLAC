package backend

import "strings"

const preferredUPCTagKey = "UPC"

var ffprobeUPCTagKeys = []string{
	"upc",
	"barcode",
	"wm/upc",
	"txxx:upc",
	"txxx:barcode",
	"txxx/upc",
	"txxx/barcode",
	"----:com.apple.itunes:upc",
	"----:com.apple.itunes:barcode",
}

func assignPreferredUPC(current *string, incoming string, preferred bool) {
	incoming = strings.TrimSpace(incoming)
	if incoming == "" {
		return
	}

	if preferred || strings.TrimSpace(*current) == "" {
		*current = incoming
	}
}

func classifyUPCDescription(description string) (matched bool, preferred bool) {
	switch strings.ToUpper(strings.TrimSpace(description)) {
	case preferredUPCTagKey:
		return true, true
	case "BARCODE":
		return true, false
	default:
		return false, false
	}
}

func firstPreferredFFprobeUPCValue(tags map[string]string) string {
	for _, key := range ffprobeUPCTagKeys {
		value := strings.TrimSpace(tags[key])
		if value != "" {
			return value
		}
	}

	return ""
}
