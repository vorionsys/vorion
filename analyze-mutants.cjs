const data = require('./reports/mutation/mutation.json');
const survived = data.files ? Object.entries(data.files) : [];

for (const [file, info] of survived) {
  if (file.includes('mfa/mfa-store') || file.includes('webauthn/middleware') || file.includes('webauthn/service')) {
    const mutants = info.mutants.filter(m => m.status === 'Survived');
    console.log('=== ' + file + ' (' + mutants.length + ' survived) ===');
    const byType = {};
    for (const m of mutants) {
      const key = m.mutatorName;
      if (!(key in byType)) byType[key] = [];
      byType[key].push(m.location.start.line);
    }
    for (const [type, lines] of Object.entries(byType)) {
      console.log('  ' + type + ' (' + lines.length + '): lines ' + lines.slice(0, 20).join(', '));
    }
    console.log('');
  }
}
