const data = require('./reports/mutation/mutation.json');
const survived = data.files ? Object.entries(data.files) : [];

for (const [file, info] of survived) {
  if (file.includes('webauthn/middleware') || file.includes('mfa/mfa-store')) {
    const mutants = info.mutants.filter(m => m.status === 'Survived');
    console.log('=== ' + file + ' (' + mutants.length + ' survived) ===');
    // Show first 20 survived mutants with details
    for (let i = 0; i < Math.min(20, mutants.length); i++) {
      const m = mutants[i];
      console.log('  [' + m.mutatorName + '] line ' + m.location.start.line + ': ' + (m.replacement || '').substring(0, 80));
    }
    console.log('');
  }
}
