const zlib = require('zlib');
const gzip = zlib.createGzip();
const fs = require('fs');
const inp = fs.createReadStream('src/test_data/state10M.json');
const out = fs.createWriteStream('src/test_data/state10M.json.gz');

inp.pipe(gzip).pipe(out);
