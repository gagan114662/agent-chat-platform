package sandbox

import (
	"fmt"
	"io/fs"
	"path/filepath"
)

// checkRepoSize walks dir and returns an error if the total regular-file bytes
// exceed maxBytes (maxBytes <= 0 disables the check). Bounds disk use post-clone.
func checkRepoSize(dir string, maxBytes int64) error {
	if maxBytes <= 0 {
		return nil
	}
	var total int64
	err := filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			info, err := d.Info()
			if err != nil {
				return err
			}
			total += info.Size()
			if total > maxBytes {
				return fmt.Errorf("repo exceeds size limit (%d bytes)", maxBytes)
			}
		}
		return nil
	})
	return err
}
