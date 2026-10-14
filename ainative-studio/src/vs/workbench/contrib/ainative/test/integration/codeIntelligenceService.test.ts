/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Integration tests for CodeIntelligenceService
 * Tests end-to-end code analysis: AST parsing, complexity analysis, symbol finding,
 * reference tracking, and import analysis using in-process Tree-Sitter parsing.
 */

import * as assert from 'assert';
import { CodeIntelligenceService, ICodeIntelligenceService, CodeIntelligenceError, CodeIntelligenceErrorCode } from '../../common/codeIntelligenceService.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';

suite('CodeIntelligenceService - Integration Tests', () => {

	let codeIntelligenceService: ICodeIntelligenceService;

	setup(() => {
		codeIntelligenceService = new CodeIntelligenceService();
	});

	teardown(() => {
		if (codeIntelligenceService instanceof Disposable) {
			codeIntelligenceService.dispose();
		}
	});

	suite('Complexity Analysis', () => {

		test('should analyze Python code complexity', async () => {
			const pythonCode = `
def simple_function(x):
    if x > 0:
        return x * 2
    return 0

def complex_function(a, b, c):
    if a > 0:
        if b > 0:
            if c > 0:
                return a + b + c
            return a + b
        return a
    return 0
`;

			const result = await codeIntelligenceService.analyzeComplexity(pythonCode, 'python');

			assert.strictEqual(result.language, 'python');
			assert.strictEqual(result.totalFunctions, 2);
			assert.strictEqual(result.averageComplexity, 3);
			assert.strictEqual(result.maxComplexity, 4);

			const simpleFunc = result.functions.find(f => f.name === 'simple_function');
			const complexFunc = result.functions.find(f => f.name === 'complex_function');

			assert.ok(simpleFunc);
			assert.strictEqual(simpleFunc?.cyclomaticComplexity, 2);
			assert.ok(complexFunc);
			assert.strictEqual(complexFunc?.cyclomaticComplexity, 4);
		});

		test('should analyze JavaScript code complexity', async () => {
			const jsCode = `
function calculateTotal(items) {
    let total = 0;
    for (const item of items) {
        if (item.active) {
            total += item.price;
        }
    }
    return total;
}
`;

			const result = await codeIntelligenceService.analyzeComplexity(jsCode, 'javascript');

			assert.strictEqual(result.language, 'javascript');
			assert.strictEqual(result.totalFunctions, 1);
			assert.strictEqual(result.functions[0].name, 'calculateTotal');
			assert.strictEqual(result.functions[0].cyclomaticComplexity, 3);
		});

		test('should reject unsupported language', async () => {
			try {
				await codeIntelligenceService.analyzeComplexity('code', 'unsupported_lang' as any);
				assert.fail('Should have thrown error');
			} catch (error) {
				assert.ok(error instanceof CodeIntelligenceError);
				assert.strictEqual((error as CodeIntelligenceError).code, CodeIntelligenceErrorCode.UnsupportedLanguage);
			}
		});

		test('should handle code with high complexity', async () => {
			const highComplexityCode = `
def very_complex_function(a, b, c, d, e):
    result = 0
    if a > 0:
        if b > 0:
            if c > 0:
                if d > 0:
                    if e > 0:
                        result = a + b + c + d + e
                    else:
                        result = a + b + c + d
                else:
                    result = a + b + c
            else:
                result = a + b
        else:
            result = a
    return result
`;

			const result = await codeIntelligenceService.analyzeComplexity(highComplexityCode, 'python');

			assert.strictEqual(result.functions[0].cyclomaticComplexity, 6);
			assert.strictEqual(result.functions[0].complexityRank, 'B');
		});
	});

	suite('AST Parsing', () => {

		test('should parse Python AST and extract symbols', async () => {
			const pythonCode = `
class Calculator:
    def __init__(self):
        self.value = 0

    def add(self, x):
        self.value += x
        return self.value

def multiply(a, b):
    return a * b

PI = 3.14159
`;

			const result = await codeIntelligenceService.parseAST(pythonCode, 'python');

			assert.strictEqual(result.language, 'python');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('Calculator'));
			assert.ok(names.includes('multiply'));
		});

		test('should parse TypeScript AST', async () => {
			const tsCode = `
class UserService {
    private users: any[] = [];

    addUser(user: any): void {
        this.users.push(user);
    }
}
`;

			const result = await codeIntelligenceService.parseAST(tsCode, 'typescript');

			assert.strictEqual(result.language, 'typescript');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('UserService'));
		});
	});

	suite('Symbol Finding', () => {

		test('should find symbol definition', async () => {
			const code = `
def calculate_total(items):
    total = 0
    for item in items:
        total += item.price
    return total
`;

			const result = await codeIntelligenceService.findSymbol(code, 'python', 'calculate_total');

			assert.strictEqual(result.found, true);
			assert.strictEqual(result.name, 'calculate_total');
			assert.strictEqual(result.type, 'function');
			assert.ok(result.location?.line! >= 1);
		});

		test('should return not found for non-existent symbol', async () => {
			const code = `
def foo():
    pass
`;

			const result = await codeIntelligenceService.findSymbol(code, 'python', 'non_existent');

			assert.strictEqual(result.found, false);
			assert.strictEqual(result.name, 'non_existent');
		});

		test('should reject empty symbol name', async () => {
			try {
				await codeIntelligenceService.findSymbol('code', 'python', '');
				assert.fail('Should have thrown error');
			} catch (error) {
				assert.ok(error instanceof CodeIntelligenceError);
			}
		});
	});

	suite('References Finding', () => {

		test('should find all references to a symbol', async () => {
			const code = `
def process_data(data):
    result = calculate(data)
    return result

def calculate(value):
    temp = calculate_temp(value)
    return temp * 2

def calculate_temp(val):
    return val + 10
`;

			const result = await codeIntelligenceService.findReferences(code, 'python', 'calculate');

			assert.strictEqual(result.symbol, 'calculate');
			assert.ok(result.count >= 2);
			assert.ok(result.references.some(r => r.type === 'call'));
		});
	});

	suite('Function Signatures', () => {

		test('should extract function signature with type annotations', async () => {
			const code = `
def calculate_discount(price: float, discount_rate: float = 0.1) -> float:
    """Calculate discounted price."""
    return price * (1 - discount_rate)
`;

			const result = await codeIntelligenceService.getFunctionSignature(code, 'python', 'calculate_discount');

			assert.strictEqual(result.found, true);
			assert.strictEqual(result.name, 'calculate_discount');
			assert.ok(result.signature?.includes('calculate_discount'));
			assert.ok(result.docstring?.includes('Calculate discounted price'));
		});
	});

	suite('Import Analysis', () => {

		test('should analyze Python imports', async () => {
			const code = `
import os
import sys
from pathlib import Path
import numpy as np
`;

			const result = await codeIntelligenceService.analyzeImports(code, 'python');

			assert.strictEqual(result.language, 'python');
			assert.ok(result.count >= 3);
			assert.ok(result.imports.includes('os'));
			assert.ok(result.imports.includes('sys'));
		});

		test('should analyze JavaScript imports', async () => {
			const code = `
import React from 'react';
import axios from 'axios';
`;

			const result = await codeIntelligenceService.analyzeImports(code, 'javascript');

			assert.strictEqual(result.language, 'javascript');
			assert.strictEqual(result.count, 2);
			assert.ok(result.imports.includes('react'));
			assert.ok(result.imports.includes('axios'));
		});
	});

	suite('Tool Schema', () => {

		test('should provide correct tool schema', () => {
			const schema = codeIntelligenceService.getToolSchema();

			assert.strictEqual(schema.name, 'code_intelligence');
			assert.ok(schema.description.includes('AST'));
			assert.strictEqual(schema.input_schema.type, 'object');
			assert.ok(schema.input_schema.properties.operation);
			assert.ok(schema.input_schema.properties.code);
			assert.ok(schema.input_schema.properties.language);
			assert.strictEqual(schema.input_schema.required?.length, 3);
		});
	});
});
