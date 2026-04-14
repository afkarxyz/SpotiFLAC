package backend

import "strings"

func normalizeArtistSeparator(separator string) string {
	separator = strings.TrimSpace(separator)
	if separator == "," || separator == ";" {
		return separator
	}
	return ""
}

func splitArtistSegment(segment string, separator string) []string {
	segment = strings.TrimSpace(segment)
	if segment == "" {
		return nil
	}

	if strings.Contains(segment, "|||SEP|||") {
		return strings.Split(segment, "|||SEP|||")
	}

	parts := []string{segment}

	if separator = normalizeArtistSeparator(separator); separator != "" {
		var separated []string
		for _, part := range parts {
			for _, item := range strings.Split(part, separator) {
				separated = append(separated, item)
			}
		}
		parts = separated
	} else if strings.Contains(segment, ";") {
		var separated []string
		for _, part := range parts {
			for _, item := range strings.Split(part, ";") {
				separated = append(separated, item)
			}
		}
		parts = separated
	}

	return parts
}

func SplitArtistCredits(artistStr, separator string) []string {
	rawParts := splitArtistSegment(artistStr, separator)
	if len(rawParts) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(rawParts))
	result := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		result = append(result, part)
	}

	return result
}

func SplitMetadataValues(value, separator string) []string {
	rawParts := splitArtistSegment(value, separator)
	if len(rawParts) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(rawParts))
	result := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		result = append(result, part)
	}

	return result
}
