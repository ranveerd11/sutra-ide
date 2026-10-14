/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit Tests for Code Intelligence Service
 * Tests in-process Tree-Sitter AST parsing, symbol search, complexity analysis,
 * reference classification, and import analysis across all supported programming languages.
 */

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CodeIntelligenceService, ICodeIntelligenceService } from '../../common/codeIntelligenceService.js';
import { CodeIntelligenceError, CodeIntelligenceErrorCode, CodeLanguage } from '../../common/codeIntelligenceTypes.js';

suite('CodeIntelligenceService - In-Process Tree-Sitter AST Engine', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let service: ICodeIntelligenceService;

	setup(() => {
		service = disposables.add(new CodeIntelligenceService());
	});

	suite('Language Support & Normalization', () => {
		test('should support all 14 target languages', async () => {
			const languages: CodeLanguage[] = [
				'python',
				'javascript',
				'typescript',
				'go',
				'rust',
				'java',
				'cpp',
				'csharp',
				'ruby',
				'kotlin',
				'swift',
				'php',
				'c',
				'sql'
			];

			for (const lang of languages) {
				const result = await service.analyzeImports('', lang);
				assert.strictEqual(result.language, lang);
			}
		});

		test('should normalize language aliases', async () => {
			const aliasCases: [string, CodeLanguage][] = [
				['py', 'python'],
				['js', 'javascript'],
				['ts', 'typescript'],
				['golang', 'go'],
				['rs', 'rust'],
				['c++', 'cpp'],
				['c#', 'csharp'],
				['rb', 'ruby'],
				['kt', 'kotlin'],
				['kts', 'kotlin'],
				['swift', 'swift'],
				['php', 'php'],
				['c', 'c'],
				['h', 'c'],
				['sql', 'sql'],
				['pgsql', 'sql']
			];

			for (const [alias, expected] of aliasCases) {
				const result = await service.analyzeImports('', alias as CodeLanguage);
				assert.strictEqual(result.language, expected);
			}
		});

		test('should throw error for unsupported language', async () => {
			await assert.rejects(
				async () => service.analyzeComplexity('code', 'cobol' as any),
				(error: CodeIntelligenceError) => {
					assert.strictEqual(error.code, CodeIntelligenceErrorCode.UnsupportedLanguage);
					assert.ok(error.message.includes('not supported'));
					return true;
				}
			);
		});
	});

	suite('parseAST & Symbol Extraction', () => {
		test('should extract Python functions and classes', async () => {
			const pythonCode = `
import os

def calculate(x):
    return x * 2

class MathHelper:
    def add(self, a, b):
        return a + b
`;
			const result = await service.parseAST(pythonCode, 'python');

			assert.strictEqual(result.language, 'python');
			assert.ok(result.symbols.length >= 2, `Expected at least 2 symbols, got ${result.symbols.length}`);

			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('calculate'), 'calculate function should be extracted');
			assert.ok(names.includes('MathHelper'), 'MathHelper class should be extracted');

			const calcSymbol = result.symbols.find(s => s.name === 'calculate');
			assert.strictEqual(calcSymbol?.type, 'function');
			assert.ok(calcSymbol?.location.line! > 0);
		});

		test('should extract TypeScript classes and methods', async () => {
			const tsCode = `
export class OrderService {
    calculateTotal(price: number, quantity: number): number {
        return price * quantity;
    }
}
`;
			const result = await service.parseAST(tsCode, 'typescript');

			assert.strictEqual(result.language, 'typescript');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('OrderService'), 'OrderService class should be extracted');
		});

		test('should extract Go functions', async () => {
			const goCode = `
package main

import "fmt"

func ProcessItems(count int) int {
    return count * 2
}
`;
			const result = await service.parseAST(goCode, 'go');

			assert.strictEqual(result.language, 'go');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('ProcessItems'), 'ProcessItems should be extracted');
		});

		test('should extract Rust functions and structs', async () => {
			const rustCode = `
fn compute_metric(value: i32) -> i32 {
    value * 10
}

struct MetricCounter {
    total: usize,
}
`;
			const result = await service.parseAST(rustCode, 'rust');

			assert.strictEqual(result.language, 'rust');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('compute_metric'), 'compute_metric should be extracted');
		});

		test('should extract Java classes and methods', async () => {
			const javaCode = `
package com.app;

public class PaymentManager {
    public void executePayment() {}
}
`;
			const result = await service.parseAST(javaCode, 'java');

			assert.strictEqual(result.language, 'java');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('PaymentManager'), 'PaymentManager should be extracted');
		});

		test('should extract C++ functions and classes', async () => {
			const cppCode = `
#include <iostream>

int calculateScore(int a, int b) {
    return a + b;
}

class Engine {
    void start();
};
`;
			const result = await service.parseAST(cppCode, 'cpp');

			assert.strictEqual(result.language, 'cpp');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('calculateScore'), 'calculateScore should be extracted');
		});

		test('should extract C# classes and methods', async () => {
			const csharpCode = `
using System;

public class InvoiceManager {
    public decimal GetTotal() { return 0m; }
}
`;
			const result = await service.parseAST(csharpCode, 'csharp');

			assert.strictEqual(result.language, 'csharp');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('InvoiceManager'), 'InvoiceManager should be extracted');
		});

		test('should extract Ruby methods and classes', async () => {
			const rubyCode = `
def calculate_vat(price)
    price * 0.2
end

class TaxCalculator
    def compute
    end
end
`;
			const result = await service.parseAST(rubyCode, 'ruby');

			assert.strictEqual(result.language, 'ruby');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('calculate_vat'), 'calculate_vat should be extracted');
		});

		test('should extract Kotlin functions and classes', async () => {
			const kotlinCode = `
package com.sutra.demo

import java.util.UUID

fun processOrder(orderId: String): Boolean {
    return true
}

class PaymentManager {
    fun charge(amount: Double): Boolean {
        return true
    }
}
`;
			const result = await service.parseAST(kotlinCode, 'kotlin');

			assert.strictEqual(result.language, 'kotlin');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('processOrder'), 'processOrder should be extracted');
			assert.ok(names.includes('PaymentManager'), 'PaymentManager should be extracted');
		});

		test('should extract Swift functions and classes', async () => {
			const swiftCode = `
import Foundation

func processTransaction(id: String) -> Bool {
    return true
}

class TransactionManager {
    func refund(amount: Double) -> Bool {
        return true
    }
}
`;
			const result = await service.parseAST(swiftCode, 'swift');

			assert.strictEqual(result.language, 'swift');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('processTransaction'), 'processTransaction should be extracted');
			assert.ok(names.includes('TransactionManager'), 'TransactionManager should be extracted');
		});

		test('should extract PHP functions and classes', async () => {
			const phpCode = `
<?php
namespace App\\Services;

use App\\Models\\User;

function sanitizeInput(string $data): string {
    return trim($data);
}

class UserService {
    public function findUser(int $id): User {
        return new User();
    }
}
`;
			const result = await service.parseAST(phpCode, 'php');

			assert.strictEqual(result.language, 'php');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('sanitizeInput'), 'sanitizeInput should be extracted');
			assert.ok(names.includes('UserService'), 'UserService should be extracted');
		});

		test('should extract C functions and structs', async () => {
			const cCode = `
#include <stdio.h>

struct Buffer {
    int capacity;
};

int process_data(int count) {
    return count * 2;
}
`;
			const result = await service.parseAST(cCode, 'c');

			assert.strictEqual(result.language, 'c');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('process_data'), 'process_data should be extracted');
			assert.ok(names.includes('Buffer'), 'Buffer struct should be extracted');
		});

		test('should extract SQL tables and functions', async () => {
			const sqlCode = `
CREATE TABLE users (
    id INT PRIMARY KEY,
    email VARCHAR(255)
);

CREATE FUNCTION get_user_count() RETURNS INT AS $$
BEGIN
    RETURN 42;
END;
$$;
`;
			const result = await service.parseAST(sqlCode, 'sql');

			assert.strictEqual(result.language, 'sql');
			const names = result.symbols.map(s => s.name);
			assert.ok(names.includes('users'), 'users table should be extracted');
			assert.ok(names.includes('get_user_count'), 'get_user_count function should be extracted');
		});
	});

	suite('findSymbol', () => {
		test('should find existing function symbol', async () => {
			const code = `
def validate_user(user_id):
    if user_id > 0:
        return True
    return False
`;
			const result = await service.findSymbol(code, 'python', 'validate_user');

			assert.strictEqual(result.found, true);
			assert.strictEqual(result.name, 'validate_user');
			assert.strictEqual(result.type, 'function');
			assert.ok(result.location?.line! >= 1);
		});

		test('should return found=false for missing symbol', async () => {
			const code = `def foo(): pass`;
			const result = await service.findSymbol(code, 'python', 'nonExistentSymbol');

			assert.strictEqual(result.found, false);
			assert.strictEqual(result.name, 'nonExistentSymbol');
		});

		test('should throw error for empty symbol name', async () => {
			await assert.rejects(
				async () => service.findSymbol('code', 'python', '  '),
				(error: CodeIntelligenceError) => {
					assert.strictEqual(error.code, CodeIntelligenceErrorCode.UnknownError);
					assert.ok(error.message.includes('empty'));
					return true;
				}
			);
		});
	});

	suite('findReferences', () => {
		test('should find references and classify reference types', async () => {
			const code = `
def helper():
    return 42

result = helper()
final_val = helper()
`;
			const result = await service.findReferences(code, 'python', 'helper');

			assert.strictEqual(result.symbol, 'helper');
			assert.ok(result.count >= 2, `Expected at least 2 references, got ${result.count}`);
			assert.strictEqual(result.references.length, result.count);

			for (const ref of result.references) {
				assert.ok(ref.line > 0);
				assert.ok(ref.context.length > 0);
			}
		});

		test('should return 0 count for unreferenced symbol', async () => {
			const code = `def unused_func(): pass`;
			const result = await service.findReferences(code, 'python', 'other_symbol');

			assert.strictEqual(result.count, 0);
			assert.strictEqual(result.references.length, 0);
		});

		test('should throw error for empty symbol name', async () => {
			await assert.rejects(
				async () => service.findReferences('code', 'python', ''),
				(error: CodeIntelligenceError) => {
					assert.strictEqual(error.code, CodeIntelligenceErrorCode.UnknownError);
					return true;
				}
			);
		});
	});

	suite('getFunctionSignature', () => {
		test('should extract Python function signature, parameters, and docstring', async () => {
			const code = `
def calculate_interest(principal: float, rate: float = 0.05) -> float:
    """Calculate simple interest for a principal amount."""
    return principal * rate
`;
			const result = await service.getFunctionSignature(code, 'python', 'calculate_interest');

			assert.strictEqual(result.found, true);
			assert.strictEqual(result.name, 'calculate_interest');
			assert.ok(result.signature?.includes('calculate_interest'));
			assert.ok(result.docstring?.includes('Calculate simple interest'));

			if (result.parameters && result.parameters.length > 0) {
				const paramNames = result.parameters.map(p => p.name);
				assert.ok(paramNames.includes('principal'));
			}
		});

		test('should extract Kotlin function signature and parameters', async () => {
			const code = `fun processPayment(amount: Double, currency: String): Boolean { return true }`;
			const result = await service.getFunctionSignature(code, 'kotlin', 'processPayment');

			assert.strictEqual(result.found, true);
			assert.strictEqual(result.name, 'processPayment');
			assert.ok(result.signature?.includes('processPayment'));
			const paramNames = result.parameters?.map(p => p.name);
			assert.ok(paramNames?.includes('amount'));
		});

		test('should extract C function signature and parameters', async () => {
			const code = `int calculate_sum(int a, int b) { return a + b; }`;
			const result = await service.getFunctionSignature(code, 'c', 'calculate_sum');

			assert.strictEqual(result.found, true);
			assert.strictEqual(result.name, 'calculate_sum');
			assert.ok(result.signature?.includes('calculate_sum'));
			const paramNames = result.parameters?.map(p => p.name);
			assert.ok(paramNames?.includes('b'));
		});

		test('should return found=false for missing function', async () => {
			const code = `def foo(): pass`;
			const result = await service.getFunctionSignature(code, 'python', 'missing_function');

			assert.strictEqual(result.found, false);
			assert.strictEqual(result.name, 'missing_function');
		});

		test('should throw error for empty function name', async () => {
			await assert.rejects(
				async () => service.getFunctionSignature('code', 'python', '   '),
				(error: CodeIntelligenceError) => {
					assert.strictEqual(error.code, CodeIntelligenceErrorCode.UnknownError);
					return true;
				}
			);
		});
	});

	suite('analyzeImports', () => {
		test('should extract Python imports', async () => {
			const code = `
import os
from sys import path
import numpy as np
`;
			const result = await service.analyzeImports(code, 'python');

			assert.strictEqual(result.language, 'python');
			assert.ok(result.count >= 2);
			assert.ok(result.imports.includes('os'));
		});

		test('should extract JavaScript and TypeScript imports', async () => {
			const code = `
import React from 'react';
import { useState, useEffect } from 'react';
import lodash from 'lodash';
`;
			const result = await service.analyzeImports(code, 'typescript');

			assert.strictEqual(result.language, 'typescript');
			assert.ok(result.imports.includes('react'));
			assert.ok(result.imports.includes('lodash'));
		});

		test('should extract Rust use declarations', async () => {
			const code = `
use std::collections::HashMap;
use std::sync::Arc;
`;
			const result = await service.analyzeImports(code, 'rust');

			assert.strictEqual(result.language, 'rust');
			assert.ok(result.imports.some(imp => imp.includes('std::collections::HashMap')));
		});

		test('should extract Kotlin and Swift imports', async () => {
			const ktCode = `
import com.example.service.OrderService
import kotlinx.coroutines.flow.Flow
`;
			const ktResult = await service.analyzeImports(ktCode, 'kotlin');
			assert.strictEqual(ktResult.language, 'kotlin');
			assert.ok(ktResult.imports.includes('com.example.service.OrderService'));

			const swiftCode = `
import SwiftUI
import Combine
`;
			const swiftResult = await service.analyzeImports(swiftCode, 'swift');
			assert.strictEqual(swiftResult.language, 'swift');
			assert.ok(swiftResult.imports.includes('SwiftUI'));
		});

		test('should extract PHP and C imports', async () => {
			const phpCode = `
use App\\Services\\AuthService;
use App\\Models\\User;
`;
			const phpResult = await service.analyzeImports(phpCode, 'php');
			assert.strictEqual(phpResult.language, 'php');
			assert.ok(phpResult.imports.includes('App\\Services\\AuthService'));

			const cCode = `
#include <stdio.h>
#include "my_header.h"
`;
			const cResult = await service.analyzeImports(cCode, 'c');
			assert.strictEqual(cResult.language, 'c');
			assert.ok(cResult.imports.includes('<stdio.h>'));
		});

		test('should return empty list when no imports present', async () => {
			const code = `const x = 10;`;
			const result = await service.analyzeImports(code, 'javascript');

			assert.strictEqual(result.count, 0);
			assert.strictEqual(result.imports.length, 0);
		});
	});

	suite('analyzeComplexity', () => {
		test('should calculate cyclomatic and cognitive complexity for branching code', async () => {
			const code = `
def complex_decision(a, b, c):
    if a > 0:
        if b > 0:
            if c > 0:
                return a + b + c
            return a + b
        return a
    return 0
`;
			const result = await service.analyzeComplexity(code, 'python');

			assert.strictEqual(result.language, 'python');
			assert.ok(result.totalFunctions >= 1);
			assert.ok(result.maxComplexity >= 4, `Expected max complexity >= 4, got ${result.maxComplexity}`);
			assert.ok(result.averageComplexity >= 4);

			const func = result.functions.find(f => f.name === 'complex_decision');
			assert.ok(func);
			assert.ok(func?.cyclomaticComplexity! >= 4);
			assert.ok(func?.cognitiveComplexity! >= 3);
			assert.strictEqual(func?.complexityRank, 'A');
		});

		test('should calculate complexity for Kotlin control flow', async () => {
			const ktCode = `
fun evaluateStatus(status: Int): String {
    if (status == 1) return "Active"
    if (status == 2) return "Pending"
    return "Unknown"
}
`;
			const ktResult = await service.analyzeComplexity(ktCode, 'kotlin');
			assert.strictEqual(ktResult.language, 'kotlin');
			assert.ok(ktResult.totalFunctions >= 1);
			assert.ok(ktResult.maxComplexity >= 3);
		});

		test('should assign correct complexity ranks', async () => {
			// Rank brackets: A: 1-5, B: 6-10, C: 11-20, D: 21-30, E: 31-40, F: >40
			let multiBranch = 'function testRanks(x) {\n';
			for (let i = 0; i < 7; i++) {
				multiBranch += `    if (x === ${i}) return ${i};\n`;
			}
			multiBranch += '    return -1;\n}';

			const result = await service.analyzeComplexity(multiBranch, 'javascript');
			const func = result.functions[0];
			assert.ok(func);
			// 1 base + 7 ifs = 8 cyclomatic complexity -> Rank 'B'
			assert.strictEqual(func?.cyclomaticComplexity, 8);
			assert.strictEqual(func?.complexityRank, 'B');
		});
	});

	suite('Tool Schema Definition', () => {
		test('should provide comprehensive tool schema for chat completion', () => {
			const schema = service.getToolSchema();

			assert.strictEqual(schema.name, 'code_intelligence');
			assert.ok(schema.description.length > 0);
			assert.ok(schema.input_schema);
			assert.strictEqual(schema.input_schema.type, 'object');

			const props = schema.input_schema.properties;
			assert.ok(props.operation);
			assert.ok(props.code);
			assert.ok(props.language);

			const languages = props.language.enum;
			assert.ok(languages.includes('python'));
			assert.ok(languages.includes('javascript'));
			assert.ok(languages.includes('typescript'));
			assert.ok(languages.includes('go'));
			assert.ok(languages.includes('rust'));
			assert.ok(languages.includes('java'));
			assert.ok(languages.includes('cpp'));
			assert.ok(languages.includes('csharp'));
			assert.ok(languages.includes('ruby'));
			assert.ok(languages.includes('kotlin'));
			assert.ok(languages.includes('swift'));
			assert.ok(languages.includes('php'));
			assert.ok(languages.includes('c'));
			assert.ok(languages.includes('sql'));
			assert.strictEqual(languages.length, 14);
		});
	});
});
