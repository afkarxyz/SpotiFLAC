package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	bolt "go.etcd.io/bbolt"
)

type HistoryItem struct {
	ID          string `json:"id"`
	SpotifyID   string `json:"spotify_id"`
	Title       string `json:"title"`
	Artists     string `json:"artists"`
	Album       string `json:"album"`
	DurationStr string `json:"duration_str"`
	CoverURL    string `json:"cover_url"`
	Quality     string `json:"quality"`
	Format      string `json:"format"`
	Path        string `json:"path"`
	Timestamp   int64  `json:"timestamp"`
}

var historyDB *bolt.DB

const (
	historyBucket = "DownloadHistory"
	maxHistory    = 10000
)

func InitHistoryDB(appName string) error {

	appDir, err := GetFFmpegDir()
	if err != nil {
		return err
	}
	if _, err := os.Stat(appDir); os.IsNotExist(err) {
		os.MkdirAll(appDir, 0755)
	}
	dbPath := filepath.Join(appDir, "history.db")

	db, err := bolt.Open(dbPath, 0600, &bolt.Options{Timeout: 1 * time.Second})
	if err != nil {
		return err
	}

	err = db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(historyBucket))
		return err
	})

	if err != nil {
		db.Close()
		return err
	}

	historyDB = db
	return nil
}

func CloseHistoryDB() {
	if historyDB != nil {
		historyDB.Close()
	}
}

func AddHistoryItem(item HistoryItem, appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte(historyBucket))
		if err != nil {
			return err
		}
		id, _ := b.NextSequence()

		item.ID = fmt.Sprintf("%d-%d", time.Now().UnixNano(), id)
		item.Timestamp = time.Now().Unix()

		buf, err := json.Marshal(item)
		if err != nil {
			return err
		}

		if b.Stats().KeyN >= maxHistory {
			c := b.Cursor()

			toDelete := maxHistory / 20
			if toDelete < 1 {
				toDelete = 1
			}

			count := 0
			for k, _ := c.First(); k != nil && count < toDelete; k, _ = c.Next() {
				if err := b.Delete(k); err != nil {
					return err
				}
				count++
			}
		}

		return b.Put([]byte(item.ID), buf)
	})
}

func GetHistoryItems(appName string) ([]HistoryItem, error) {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return nil, err
		}
	}
	var items []HistoryItem
	err := historyDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(historyBucket))
		if b == nil {
			return nil
		}
		c := b.Cursor()

		for k, v := c.First(); k != nil; k, v = c.Next() {
			var item HistoryItem
			if err := json.Unmarshal(v, &item); err == nil {
				items = append(items, item)
			}
		}
		return nil
	})

	sort.Slice(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})

	return items, err
}

func ClearHistory(appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		return tx.DeleteBucket([]byte(historyBucket))
	})
}

type FetchHistoryItem struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Type      string `json:"type"`
	Name      string `json:"name"`
	Info      string `json:"info"`
	Image     string `json:"image"`
	Data      string `json:"data"`
	Timestamp int64  `json:"timestamp"`
}

const (
	fetchHistoryBucket = "FetchHistory"
)

func AddFetchHistoryItem(item FetchHistoryItem, appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		b, err := tx.CreateBucketIfNotExists([]byte(fetchHistoryBucket))
		if err != nil {
			return err
		}
		id, _ := b.NextSequence()

		if item.URL != "" {
			c := b.Cursor()
			for k, v := c.First(); k != nil; k, v = c.Next() {
				var existing FetchHistoryItem
				if err := json.Unmarshal(v, &existing); err == nil {
					if existing.URL == item.URL && existing.Type == item.Type {
						if err := b.Delete(k); err != nil {
							return err
						}
					}
				}
			}
		}

		item.ID = fmt.Sprintf("%d-%d", time.Now().UnixNano(), id)
		item.Timestamp = time.Now().Unix()

		buf, err := json.Marshal(item)
		if err != nil {
			return err
		}

		if b.Stats().KeyN >= maxHistory {
			c := b.Cursor()
			toDelete := maxHistory / 20
			if toDelete < 1 {
				toDelete = 1
			}
			count := 0
			for k, _ := c.First(); k != nil && count < toDelete; k, _ = c.Next() {
				if err := b.Delete(k); err != nil {
					return err
				}
				count++
			}
		}

		return b.Put([]byte(item.ID), buf)
	})
}

func GetFetchHistoryItems(appName string) ([]FetchHistoryItem, error) {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return nil, err
		}
	}
	var items []FetchHistoryItem
	err := historyDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(fetchHistoryBucket))
		if b == nil {
			return nil
		}
		c := b.Cursor()

		for k, v := c.First(); k != nil; k, v = c.Next() {
			var item FetchHistoryItem
			if err := json.Unmarshal(v, &item); err == nil {
				items = append(items, item)
			}
		}
		return nil
	})

	sort.Slice(items, func(i, j int) bool {
		return items[i].Timestamp > items[j].Timestamp
	})

	return items, err
}

func ClearFetchHistory(appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		return tx.DeleteBucket([]byte(fetchHistoryBucket))
	})
}

func ClearFetchHistoryByType(itemType string, appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(fetchHistoryBucket))
		if b == nil {
			return nil
		}

		var keysToDelete [][]byte

		c := b.Cursor()
		for k, v := c.First(); k != nil; k, v = c.Next() {
			var item FetchHistoryItem
			if err := json.Unmarshal(v, &item); err == nil {
				if item.Type == itemType {
					keysToDelete = append(keysToDelete, k)
				}
			}
		}

		for _, k := range keysToDelete {
			if err := b.Delete(k); err != nil {
				return err
			}
		}
		return nil
	})
}

func DeleteHistoryItem(id string, appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(historyBucket))
		if b == nil {
			return nil
		}

		return b.Delete([]byte(id))
	})
}

func DeleteFetchHistoryItem(id string, appName string) error {
	if historyDB == nil {
		if err := InitHistoryDB(appName); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(fetchHistoryBucket))
		if b == nil {
			return nil
		}
		return b.Delete([]byte(id))
	})
}
