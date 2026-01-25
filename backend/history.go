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
	configBucket  = "Config"
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
		if _, err := tx.CreateBucketIfNotExists([]byte(historyBucket)); err != nil {
			return err
		}
		if _, err := tx.CreateBucketIfNotExists([]byte(configBucket)); err != nil {
			return err
		}
		return nil
	})

	if err != nil {
		db.Close()
		return err
	}

	historyDB = db
	return nil
}

func SetConfiguration(key, value string) error {
	if historyDB == nil {
		if err := InitHistoryDB("SpotiFLAC"); err != nil {
			return err
		}
	}
	return historyDB.Update(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(configBucket))
		if b == nil {
			return fmt.Errorf("config bucket does not exist")
		}
		if b == nil {
			return fmt.Errorf("config bucket %s not found", configBucket)
		}
		return b.Put([]byte(key), []byte(value))
	})
}

func GetConfiguration(key string) (string, error) {
	if historyDB == nil {
		if err := InitHistoryDB("SpotiFLAC"); err != nil {
			return "", err
		}
	}
	var value string
	err := historyDB.View(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(configBucket))
		if b == nil {
			return fmt.Errorf("config bucket %s not found", configBucket)
		}
		v := b.Get([]byte(key))
		if v != nil {
			value = string(v)
		}
		return nil
	})
	return value, err
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
		b := tx.Bucket([]byte(historyBucket))
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
