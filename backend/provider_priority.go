package backend

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	providerPriorityDBFile = "provider_priority.db"
	providerPriorityBucket = "ProviderPriority"
)

type providerPriorityEntry struct {
	Service      string `json:"service"`
	Provider     string `json:"provider"`
	LastOutcome  string `json:"last_outcome"`
	LastAttempt  int64  `json:"last_attempt"`
	LastSuccess  int64  `json:"last_success"`
	LastFailure  int64  `json:"last_failure"`
	SuccessCount int64  `json:"success_count"`
	FailureCount int64  `json:"failure_count"`
}

var (
	providerPriorityDB   *bolt.DB
	providerPriorityDBMu sync.Mutex
)

func InitProviderPriorityDB() error {
	providerPriorityDBMu.Lock()
	defer providerPriorityDBMu.Unlock()

	if providerPriorityDB != nil {
		return nil
	}

	appDir, err := EnsureAppDir()
	if err != nil {
		return err
	}

	dbPath := filepath.Join(appDir, providerPriorityDBFile)
	db, err := bolt.Open(dbPath, 0o600, &bolt.Options{Timeout: 1 * time.Second})
	if err != nil {
		return err
	}

	if err := db.Update(func(tx *bolt.Tx) error {
		_, err := tx.CreateBucketIfNotExists([]byte(providerPriorityBucket))
		return err
	}); err != nil {
		db.Close()
		return err
	}

	providerPriorityDB = db
	return nil
}

func CloseProviderPriorityDB() {
	providerPriorityDBMu.Lock()
	defer providerPriorityDBMu.Unlock()

	if providerPriorityDB != nil {
		_ = providerPriorityDB.Close()
		providerPriorityDB = nil
	}
}

func prioritizeProviders(service string, providers []string) []string {
	ordered := append([]string(nil), providers...)
	if len(ordered) < 2 {
		return ordered
	}

	if err := InitProviderPriorityDB(); err != nil {
		fmt.Printf("Warning: failed to init provider priority DB: %v\n", err)
		return ordered
	}

	serviceKey := strings.TrimSpace(strings.ToLower(service))
	entries := make(map[string]providerPriorityEntry, len(ordered))

	if err := providerPriorityDB.View(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(providerPriorityBucket))
		if bucket == nil {
			return nil
		}

		for _, provider := range ordered {
			if raw := bucket.Get([]byte(providerPriorityKey(serviceKey, provider))); len(raw) > 0 {
				var entry providerPriorityEntry
				if err := json.Unmarshal(raw, &entry); err != nil {
					return err
				}
				entries[provider] = entry
			}
		}
		return nil
	}); err != nil {
		fmt.Printf("Warning: failed to read provider priority DB: %v\n", err)
		return ordered
	}

	originalIndex := make(map[string]int, len(ordered))
	for idx, provider := range ordered {
		originalIndex[provider] = idx
	}

	sort.SliceStable(ordered, func(i, j int) bool {
		left := entries[ordered[i]]
		right := entries[ordered[j]]

		leftRank := providerOutcomeRank(left.LastOutcome)
		rightRank := providerOutcomeRank(right.LastOutcome)
		if leftRank != rightRank {
			return leftRank > rightRank
		}

		if left.LastSuccess != right.LastSuccess {
			return left.LastSuccess > right.LastSuccess
		}

		if left.LastAttempt != right.LastAttempt {
			return left.LastAttempt > right.LastAttempt
		}

		return originalIndex[ordered[i]] < originalIndex[ordered[j]]
	})

	return ordered
}

func recordProviderSuccess(service string, provider string) {
	recordProviderOutcome(service, provider, true)
}

func recordProviderFailure(service string, provider string) {
	recordProviderOutcome(service, provider, false)
}

func recordProviderOutcome(service string, provider string, success bool) {
	if strings.TrimSpace(service) == "" || strings.TrimSpace(provider) == "" {
		return
	}

	if err := InitProviderPriorityDB(); err != nil {
		fmt.Printf("Warning: failed to init provider priority DB: %v\n", err)
		return
	}

	serviceKey := strings.TrimSpace(strings.ToLower(service))
	providerKey := providerPriorityKey(serviceKey, provider)
	now := time.Now().Unix()

	if err := providerPriorityDB.Update(func(tx *bolt.Tx) error {
		bucket, err := tx.CreateBucketIfNotExists([]byte(providerPriorityBucket))
		if err != nil {
			return err
		}

		entry := providerPriorityEntry{
			Service:  serviceKey,
			Provider: provider,
		}

		if raw := bucket.Get([]byte(providerKey)); len(raw) > 0 {
			if err := json.Unmarshal(raw, &entry); err != nil {
				return err
			}
		}

		entry.LastAttempt = now
		if success {
			entry.LastOutcome = "success"
			entry.LastSuccess = now
			entry.SuccessCount++
		} else {
			entry.LastOutcome = "failure"
			entry.LastFailure = now
			entry.FailureCount++
		}

		payload, err := json.Marshal(entry)
		if err != nil {
			return err
		}

		return bucket.Put([]byte(providerKey), payload)
	}); err != nil {
		fmt.Printf("Warning: failed to update provider priority DB: %v\n", err)
	}
}

func providerOutcomeRank(outcome string) int {
	switch strings.TrimSpace(strings.ToLower(outcome)) {
	case "success":
		return 2
	case "":
		return 1
	default:
		return 0
	}
}

func providerPriorityKey(service string, provider string) string {
	return strings.TrimSpace(strings.ToLower(service)) + "|" + strings.TrimSpace(provider)
}
