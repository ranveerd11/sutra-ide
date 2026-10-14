/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

/**
 * Code Intelligence Service
 * Provides high-level in-process code analysis operations using Tree-Sitter WASM AST parsing.
 * Supports Python, JavaScript, TypeScript, Go, Rust, Java, C++, C#, Ruby, Kotlin, Swift, PHP, C, and SQL with local execution.
 */

import { Disposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ToolDefinition } from './managedChatAPIService.js';
import {
	CodeLanguage,
	ASTResult,
	SymbolResult,
	ReferencesResult,
	SignatureResult,
	ImportsResult,
	ComplexityResult,
	CodeIntelligenceError,
	CodeIntelligenceErrorCode
} from './codeIntelligenceTypes.js';
import { TreeSitterAnalyzer, normalizeLanguage } from './treeSitterAnalyzer.js';

// Re-export types for convenience
export * from './codeIntelligenceTypes.js';

/**
 * Service interface for code intelligence operations
 */
export const ICodeIntelligenceService = createDecorator<ICodeIntelligenceService>('codeIntelligenceService');

export interface ICodeIntelligenceService {
	readonly _serviceBrand: undefined;

	/**
	 * Analyze code complexity metrics
	 *
	 * Calculates cyclomatic complexity (decision points), cognitive complexity (difficulty),
	 * and maintainability index for all functions in the code.
	 */
	analyzeComplexity(code: string, language: CodeLanguage): Promise<ComplexityResult>;

	/**
	 * Parse code into Abstract Syntax Tree and extract symbols
	 */
	parseAST(code: string, language: CodeLanguage): Promise<ASTResult>;

	/**
	 * Find symbol definition in code
	 */
	findSymbol(code: string, language: CodeLanguage, symbolName: string): Promise<SymbolResult>;

	/**
	 * Find all references to a symbol
	 */
	findReferences(code: string, language: CodeLanguage, symbolName: string): Promise<ReferencesResult>;

	/**
	 * Get function signature with type annotations and docstring
	 */
	getFunctionSignature(code: string, language: CodeLanguage, functionName: string): Promise<SignatureResult>;

	/**
	 * Analyze import statements
	 */
	analyzeImports(code: string, language: CodeLanguage): Promise<ImportsResult>;

	/**
	 * Get the code_intelligence tool schema for use with chat completions
	 */
	getToolSchema(): ToolDefinition;
}

/**
 * Code Intelligence Service Implementation
 * Executes AST parsing and semantic metrics locally in-process via TreeSitterAnalyzer.
 */
export class CodeIntelligenceService extends Disposable implements ICodeIntelligenceService {
	readonly _serviceBrand: undefined;

	private static readonly SUPPORTED_LANGUAGES: ReadonlySet<CodeLanguage> = new Set<CodeLanguage>([
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
	]);

	constructor(
		_legacyChatAPI?: any
	) {
		super();
	}

	/**
	 * Analyze code complexity
	 */
	async analyzeComplexity(code: string, language: CodeLanguage): Promise<ComplexityResult> {
		const lang = this._validateLanguage(language);
		return TreeSitterAnalyzer.analyzeComplexity(code, lang);
	}

	/**
	 * Parse code to AST
	 */
	async parseAST(code: string, language: CodeLanguage): Promise<ASTResult> {
		const lang = this._validateLanguage(language);
		return TreeSitterAnalyzer.parseAST(code, lang);
	}

	/**
	 * Find symbol definition
	 */
	async findSymbol(code: string, language: CodeLanguage, symbolName: string): Promise<SymbolResult> {
		const lang = this._validateLanguage(language);

		if (!symbolName || symbolName.trim().length === 0) {
			throw new CodeIntelligenceError(
				CodeIntelligenceErrorCode.UnknownError,
				'Symbol name cannot be empty'
			);
		}

		return TreeSitterAnalyzer.findSymbol(code, lang, symbolName);
	}

	/**
	 * Find references to symbol
	 */
	async findReferences(code: string, language: CodeLanguage, symbolName: string): Promise<ReferencesResult> {
		const lang = this._validateLanguage(language);

		if (!symbolName || symbolName.trim().length === 0) {
			throw new CodeIntelligenceError(
				CodeIntelligenceErrorCode.UnknownError,
				'Symbol name cannot be empty'
			);
		}

		return TreeSitterAnalyzer.findReferences(code, lang, symbolName);
	}

	/**
	 * Get function signature
	 */
	async getFunctionSignature(code: string, language: CodeLanguage, functionName: string): Promise<SignatureResult> {
		const lang = this._validateLanguage(language);

		if (!functionName || functionName.trim().length === 0) {
			throw new CodeIntelligenceError(
				CodeIntelligenceErrorCode.UnknownError,
				'Function name cannot be empty'
			);
		}

		return TreeSitterAnalyzer.getFunctionSignature(code, lang, functionName);
	}

	/**
	 * Analyze imports
	 */
	async analyzeImports(code: string, language: CodeLanguage): Promise<ImportsResult> {
		const lang = this._validateLanguage(language);
		return TreeSitterAnalyzer.analyzeImports(code, lang);
	}

	/**
	 * Get code_intelligence tool schema
	 */
	getToolSchema(): ToolDefinition {
		return {
			name: 'code_intelligence',
			description: 'Analyze code with AST parsing, symbol finding, complexity metrics, and reference tracking. Supports Python, JavaScript, TypeScript, Go, Rust, Java, C++, C#, Ruby, Kotlin, Swift, PHP, C, SQL.',
			input_schema: {
				type: 'object',
				properties: {
					operation: {
						type: 'string',
						enum: ['parse_ast', 'find_symbol', 'find_references', 'analyze_imports', 'get_function_signature', 'analyze_complexity'],
						description: 'Code intelligence operation to perform'
					},
					code: {
						type: 'string',
						description: 'Source code to analyze'
					},
					language: {
						type: 'string',
						enum: [
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
						],
						description: 'Programming language'
					},
					symbol_name: {
						type: 'string',
						description: 'Symbol name to search for (required for find_symbol, find_references)'
					},
					function_name: {
						type: 'string',
						description: 'Function name to extract signature (required for get_function_signature)'
					}
				},
				required: ['operation', 'code', 'language']
			}
		};
	}

	/**
	 * Validate and normalize language
	 */
	private _validateLanguage(language: CodeLanguage): CodeLanguage {
		const normalized = normalizeLanguage(language);
		if (!normalized || !CodeIntelligenceService.SUPPORTED_LANGUAGES.has(normalized)) {
			throw new CodeIntelligenceError(
				CodeIntelligenceErrorCode.UnsupportedLanguage,
				`Language '${language}' is not supported. Supported languages: ${Array.from(CodeIntelligenceService.SUPPORTED_LANGUAGES).join(', ')}`
			);
		}
		return normalized;
	}

	override dispose(): void {
		super.dispose();
	}
}

// Register the service with VS Code dependency injection
registerSingleton(ICodeIntelligenceService, CodeIntelligenceService, InstantiationType.Delayed);
