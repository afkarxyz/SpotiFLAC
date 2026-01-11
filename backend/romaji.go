package backend

import (
	"strings"
	"unicode"
)

var hiraganaToRomaji = map[rune]string{
	'あ': "a", 'い': "i", 'う': "u", 'え': "e", 'お': "o",
	'か': "ka", 'き': "ki", 'く': "ku", 'け': "ke", 'こ': "ko",
	'さ': "sa", 'し': "shi", 'す': "su", 'せ': "se", 'そ': "so",
	'た': "ta", 'ち': "chi", 'つ': "tsu", 'て': "te", 'と': "to",
	'な': "na", 'に': "ni", 'ぬ': "nu", 'ね': "ne", 'の': "no",
	'は': "ha", 'ひ': "hi", 'ふ': "fu", 'へ': "he", 'ほ': "ho",
	'ま': "ma", 'み': "mi", 'む': "mu", 'め': "me", 'も': "mo",
	'や': "ya", 'ゆ': "yu", 'よ': "yo",
	'ら': "ra", 'り': "ri", 'る': "ru", 'れ': "re", 'ろ': "ro",
	'わ': "wa", 'を': "wo", 'ん': "n",

	'が': "ga", 'ぎ': "gi", 'ぐ': "gu", 'げ': "ge", 'ご': "go",
	'ざ': "za", 'じ': "ji", 'ず': "zu", 'ぜ': "ze", 'ぞ': "zo",
	'だ': "da", 'ぢ': "ji", 'づ': "zu", 'で': "de", 'ど': "do",
	'ば': "ba", 'び': "bi", 'ぶ': "bu", 'べ': "be", 'ぼ': "bo",

	'ぱ': "pa", 'ぴ': "pi", 'ぷ': "pu", 'ぺ': "pe", 'ぽ': "po",

	'ゃ': "ya", 'ゅ': "yu", 'ょ': "yo",
	'っ': "",
	'ぁ': "a", 'ぃ': "i", 'ぅ': "u", 'ぇ': "e", 'ぉ': "o",
}

var katakanaToRomaji = map[rune]string{
	'ア': "a", 'イ': "i", 'ウ': "u", 'エ': "e", 'オ': "o",
	'カ': "ka", 'キ': "ki", 'ク': "ku", 'ケ': "ke", 'コ': "ko",
	'サ': "sa", 'シ': "shi", 'ス': "su", 'セ': "se", 'ソ': "so",
	'タ': "ta", 'チ': "chi", 'ツ': "tsu", 'テ': "te", 'ト': "to",
	'ナ': "na", 'ニ': "ni", 'ヌ': "nu", 'ネ': "ne", 'ノ': "no",
	'ハ': "ha", 'ヒ': "hi", 'フ': "fu", 'ヘ': "he", 'ホ': "ho",
	'マ': "ma", 'ミ': "mi", 'ム': "mu", 'メ': "me", 'モ': "mo",
	'ヤ': "ya", 'ユ': "yu", 'ヨ': "yo",
	'ラ': "ra", 'リ': "ri", 'ル': "ru", 'レ': "re", 'ロ': "ro",
	'ワ': "wa", 'ヲ': "wo", 'ン': "n",

	'ガ': "ga", 'ギ': "gi", 'グ': "gu", 'ゲ': "ge", 'ゴ': "go",
	'ザ': "za", 'ジ': "ji", 'ズ': "zu", 'ゼ': "ze", 'ゾ': "zo",
	'ダ': "da", 'ヂ': "ji", 'ヅ': "zu", 'デ': "de", 'ド': "do",
	'バ': "ba", 'ビ': "bi", 'ブ': "bu", 'ベ': "be", 'ボ': "bo",

	'パ': "pa", 'ピ': "pi", 'プ': "pu", 'ペ': "pe", 'ポ': "po",

	'ャ': "ya", 'ュ': "yu", 'ョ': "yo",
	'ッ': "",
	'ァ': "a", 'ィ': "i", 'ゥ': "u", 'ェ': "e", 'ォ': "o",

	'ー': "",
	'ヴ': "vu",
}

var combinationHiragana = map[string]string{
	"きゃ": "kya", "きゅ": "kyu", "きょ": "kyo",
	"しゃ": "sha", "しゅ": "shu", "しょ": "sho",
	"ちゃ": "cha", "ちゅ": "chu", "ちょ": "cho",
	"にゃ": "nya", "にゅ": "nyu", "にょ": "nyo",
	"ひゃ": "hya", "ひゅ": "hyu", "ひょ": "hyo",
	"みゃ": "mya", "みゅ": "myu", "みょ": "myo",
	"りゃ": "rya", "りゅ": "ryu", "りょ": "ryo",
	"ぎゃ": "gya", "ぎゅ": "gyu", "ぎょ": "gyo",
	"じゃ": "ja", "じゅ": "ju", "じょ": "jo",
	"びゃ": "bya", "びゅ": "byu", "びょ": "byo",
	"ぴゃ": "pya", "ぴゅ": "pyu", "ぴょ": "pyo",
}

var combinationKatakana = map[string]string{
	"キャ": "kya", "キュ": "kyu", "キョ": "kyo",
	"シャ": "sha", "シュ": "shu", "ショ": "sho",
	"チャ": "cha", "チュ": "chu", "チョ": "cho",
	"ニャ": "nya", "ニュ": "nyu", "ニョ": "nyo",
	"ヒャ": "hya", "ヒュ": "hyu", "ヒョ": "hyo",
	"ミャ": "mya", "ミュ": "myu", "ミョ": "myo",
	"リャ": "rya", "リュ": "ryu", "リョ": "ryo",
	"ギャ": "gya", "ギュ": "gyu", "ギョ": "gyo",
	"ジャ": "ja", "ジュ": "ju", "ジョ": "jo",
	"ビャ": "bya", "ビュ": "byu", "ビョ": "byo",
	"ピャ": "pya", "ピュ": "pyu", "ピョ": "pyo",

	"ティ": "ti", "ディ": "di", "トゥ": "tu", "ドゥ": "du",
	"ファ": "fa", "フィ": "fi", "フェ": "fe", "フォ": "fo",
	"ウィ": "wi", "ウェ": "we", "ウォ": "wo",
}

func ContainsJapanese(s string) bool {
	for _, r := range s {
		if isHiragana(r) || isKatakana(r) || isKanji(r) {
			return true
		}
	}
	return false
}

func isHiragana(r rune) bool {
	return r >= 0x3040 && r <= 0x309F
}

func isKatakana(r rune) bool {
	return r >= 0x30A0 && r <= 0x30FF
}

func isKanji(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) ||
		(r >= 0x3400 && r <= 0x4DBF)
}

func JapaneseToRomaji(text string) string {
	if !ContainsJapanese(text) {
		return text
	}

	var result strings.Builder
	runes := []rune(text)
	i := 0

	for i < len(runes) {

		if i < len(runes)-1 && (runes[i] == 'っ' || runes[i] == 'ッ') {
			nextRomaji := ""
			if romaji, ok := hiraganaToRomaji[runes[i+1]]; ok {
				nextRomaji = romaji
			} else if romaji, ok := katakanaToRomaji[runes[i+1]]; ok {
				nextRomaji = romaji
			}
			if len(nextRomaji) > 0 {
				result.WriteByte(nextRomaji[0])
			}
			i++
			continue
		}

		if i < len(runes)-1 {
			combo := string(runes[i : i+2])
			if romaji, ok := combinationHiragana[combo]; ok {
				result.WriteString(romaji)
				i += 2
				continue
			}
			if romaji, ok := combinationKatakana[combo]; ok {
				result.WriteString(romaji)
				i += 2
				continue
			}
		}

		r := runes[i]
		if romaji, ok := hiraganaToRomaji[r]; ok {
			result.WriteString(romaji)
		} else if romaji, ok := katakanaToRomaji[r]; ok {
			result.WriteString(romaji)
		} else if isKanji(r) {

			result.WriteRune(r)
		} else {

			result.WriteRune(r)
		}
		i++
	}

	return result.String()
}

func BuildSearchQuery(trackName, artistName string) string {

	trackRomaji := JapaneseToRomaji(trackName)
	artistRomaji := JapaneseToRomaji(artistName)

	trackClean := cleanSearchQuery(trackRomaji)
	artistClean := cleanSearchQuery(artistRomaji)

	return strings.TrimSpace(artistClean + " " + trackClean)
}

func cleanSearchQuery(s string) string {
	var result strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsSpace(r) {
			result.WriteRune(r)
		} else if r == '-' || r == '\'' {
			result.WriteRune(r)
		}
	}
	return strings.TrimSpace(result.String())
}

func cleanToASCII(s string) string {
	var result strings.Builder
	for _, r := range s {

		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == ' ' || r == '-' || r == '\'' {
			result.WriteRune(r)
		} else if r == ',' || r == '.' {

			result.WriteRune(' ')
		}
	}

	cleaned := strings.Join(strings.Fields(result.String()), " ")
	return strings.TrimSpace(cleaned)
}
