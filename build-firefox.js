const fs = require('fs');
const { execSync } = require('child_process');

// Backup original manifest
if (fs.existsSync('manifest.json')) {
  fs.copyFileSync('manifest.json', 'manifest.json.bak');
}

// Copy Firefox manifest
fs.copyFileSync('manifest.firefox.json', 'manifest.json');

try {
  // Build Firefox extension
  execSync('web-ext build --source-dir=. --artifacts-dir=./dist --filename=7tv-ext-{version}.xpi --overwrite-dest', { stdio: 'inherit' });
} finally {
  // Restore original manifest
  if (fs.existsSync('manifest.json.bak')) {
    fs.copyFileSync('manifest.json.bak', 'manifest.json');
    fs.unlinkSync('manifest.json.bak');
  }
}
