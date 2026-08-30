import fs from 'fs';
import path from 'path';
import { evaluatePineScript } from '../../../breakoutex-ai-mobile/src/pine-engine/evaluator';
import { PINE_V6_TEMPLATES } from '../../../breakoutex-ai-mobile/src/pine-engine/templates';
import { STRATEGY_LIBRARY } from '../../../breakoutex-ai-mobile/src/pine/strategy-library';

interface TestResult {
    category: string;
    name: string;
    isValid: boolean;
    hasErrors: boolean;
    hasWarnings: boolean;
    errorMessages: string[];
    warningMessages: string[];
}

const results: TestResult[] = [];

console.log('================================================================');
console.log('       BREAKOUTEX AI — FULL PINE SCRIPT EVALUATOR AUDIT         ');
console.log('================================================================\n');

// 1. Audit PINE_V6_TEMPLATES (14 Templates)
console.log('--- 1. Testing Built-in Pine v6 Templates (14 Strategies) ---');
PINE_V6_TEMPLATES.forEach((tmpl, i) => {
    const res = evaluatePineScript(tmpl.code);
    results.push({
        category: 'Pine v6 Templates',
        name: tmpl.name || tmpl.id,
        isValid: res.isValid,
        hasErrors: res.hasErrors,
        hasWarnings: res.hasWarnings,
        errorMessages: res.errors.map(e => `[L${e.line}] ${e.message}`),
        warningMessages: res.warnings.map(w => `[L${w.line}] ${w.message}`),
    });
    const status = res.isValid ? '✓ VALID' : '✗ INVALID';
    console.log(`[${String(i + 1).padStart(2, '0')}/14] ${status.padEnd(10)} | ${tmpl.name}`);
    if (res.errors.length > 0) console.error('   Errors:', res.errors);
});

// 2. Audit STRATEGY_LIBRARY (12 Core MTF Strategies)
console.log('\n--- 2. Testing Core MTF Strategy Library (12 Strategies) ---');
const stratEntries = Object.entries(STRATEGY_LIBRARY);
stratEntries.forEach(([id, strat], i) => {
    const res = evaluatePineScript(strat.pineScript);
    results.push({
        category: 'Core MTF Library',
        name: strat.name || id,
        isValid: res.isValid,
        hasErrors: res.hasErrors,
        hasWarnings: res.hasWarnings,
        errorMessages: res.errors.map(e => `[L${e.line}] ${e.message}`),
        warningMessages: res.warnings.map(w => `[L${w.line}] ${w.message}`),
    });
    const status = res.isValid ? '✓ VALID' : '✗ INVALID';
    console.log(`[${String(i + 1).padStart(2, '0')}/12] ${status.padEnd(10)} | ${strat.name || id}`);
    if (res.errors.length > 0) console.error('   Errors:', res.errors);
});

// 3. Audit pine-exports/*.pine directory files
console.log('\n--- 3. Testing Exported Pine Files (pine-exports/*.pine) ---');
const exportsDir = path.resolve(__dirname, '../../pine-exports');
if (fs.existsSync(exportsDir)) {
    const files = fs.readdirSync(exportsDir).filter(f => f.endsWith('.pine'));
    files.forEach((file, i) => {
        const fullPath = path.join(exportsDir, file);
        const code = fs.readFileSync(fullPath, 'utf8');
        const res = evaluatePineScript(code);
        results.push({
            category: 'Pine Exports',
            name: file,
            isValid: res.isValid,
            hasErrors: res.hasErrors,
            hasWarnings: res.hasWarnings,
            errorMessages: res.errors.map(e => `[L${e.line}] ${e.message}`),
            warningMessages: res.warnings.map(w => `[L${w.line}] ${w.message}`),
        });
        const status = res.isValid ? '✓ VALID' : '✗ INVALID';
        console.log(`[${String(i + 1).padStart(2, '0')}/${files.length}] ${status.padEnd(10)} | ${file}`);
        if (res.errors.length > 0) console.error('   Errors:', res.errors);
    });
}

// 4. Test User & Test Scripts in breakoutex-ai-mobile/scripts/
console.log('\n--- 4. Testing Script Scenarios in Mobile Workspace ---');
const scriptFiles = [
    'test-ai-scripts.ts',
    'test-user-pinescript.ts',
    'test-xrp-bollinger.ts',
];
const mobileScriptsDir = path.resolve(__dirname, '../../../breakoutex-ai-mobile/scripts');
scriptFiles.forEach((file, i) => {
    const fullPath = path.join(mobileScriptsDir, file);
    if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Extract embedded pine scripts enclosed in backticks starting with //@version
        const regex = /`(\/\/@version=[\s\S]*?)`/g;
        let match;
        let count = 0;
        while ((match = regex.exec(content)) !== null) {
            count++;
            const pineCode = match[1].trim();
            const res = evaluatePineScript(pineCode);
            results.push({
                category: 'Script Scenarios',
                name: `${file} [script #${count}]`,
                isValid: res.isValid,
                hasErrors: res.hasErrors,
                hasWarnings: res.hasWarnings,
                errorMessages: res.errors.map(e => `[L${e.line}] ${e.message}`),
                warningMessages: res.warnings.map(w => `[L${w.line}] ${w.message}`),
            });
            const status = res.isValid ? '✓ VALID' : '✗ INVALID';
            console.log(`[${String(count).padStart(2, '0')}] ${status.padEnd(10)} | ${file} (#${count})`);
            if (res.errors.length > 0) {
                console.error('   Errors:', res.errors);
            }
        }
    }
});

// Final Summary
const totalTested = results.length;
const totalValid = results.filter(r => r.isValid).length;
const totalInvalid = results.filter(r => !r.isValid).length;

console.log('\n================================================================');
console.log(`TOTAL SCRIPTS TESTED : ${totalTested}`);
console.log(`PASSED (VALID)       : ${totalValid}`);
console.log(`FAILED (INVALID)     : ${totalInvalid}`);
console.log(`PASS RATE            : ${((totalValid / totalTested) * 100).toFixed(1)}%`);
console.log('================================================================\n');

if (totalInvalid > 0) {
    console.error('Failed Scripts Details:');
    results.filter(r => !r.isValid).forEach(r => {
        console.error(`- [${r.category}] ${r.name}:`, r.errorMessages);
    });
    process.exit(1);
} else {
    console.log('🎉 ALL EXISTING PINE SCRIPTS COMPILED AND VALIDATED SUCCESSFULLY!');
}
