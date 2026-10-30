import subprocess

# Let's run a script with node that executes parseEwsxSchedule on 23 Agustus 2026.ewsx!
js_test = """
const fs = require('fs');
const initSqlJs = require('D:/LCD/obs-easyworship-plugin/lib/sql-wasm.js');

async function test() {
  const SQL = await initSqlJs();
  const AdmZip = require('D:/LCD/obs-easyworship-plugin/node_modules/jszip'); // wait, let's see if jszip exists
}
"""

