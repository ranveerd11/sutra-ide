/*---------------------------------------------------------------------------------------------
 *  Copyright (c) AINative Studio. All rights reserved.
 *  Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import {
	CodeLanguage,
	ASTResult,
	Symbol,
	SymbolType,
	SymbolResult,
	ReferencesResult,
	SymbolReference,
	ReferenceType,
	SignatureResult,
	FunctionParameter,
	ImportsResult,
	ComplexityResult,
	FunctionComplexity,
	ComplexityRank
} from './codeIntelligenceTypes.js';

interface TreeSitterNode {
	type: string;
	text: string;
	startPosition: { row: number; column: number };
	endPosition: { row: number; column: number };
	children: TreeSitterNode[];
	childForFieldName(fieldName: string): TreeSitterNode | null;
}

interface TreeSitterTree {
	rootNode: TreeSitterNode;
}

interface TreeSitterParserInstance {
	setLanguage(language: any): void;
	parse(content: string): TreeSitterTree | null;
}

interface TreeSitterModule {
	Parser: {
		new(): TreeSitterParserInstance;
		init(options: { locateFile: (file: string, folder: string) => string }): Promise<void>;
	};
	Language: {
		load(input: string | Uint8Array): Promise<any>;
	};
}

const WASM_FILE_MAP: Record<CodeLanguage, string> = {
	python: 'tree-sitter-python.wasm',
	javascript: 'tree-sitter-javascript.wasm',
	typescript: 'tree-sitter-typescript.wasm',
	go: 'tree-sitter-go.wasm',
	rust: 'tree-sitter-rust.wasm',
	java: 'tree-sitter-java.wasm',
	cpp: 'tree-sitter-cpp.wasm',
	csharp: 'tree-sitter-c-sharp.wasm',
	ruby: 'tree-sitter-ruby.wasm',
	kotlin: 'tree-sitter-kotlin.wasm',
	swift: 'tree-sitter-swift.wasm',
	php: 'tree-sitter-php.wasm',
	c: 'tree-sitter-c.wasm',
	sql: 'tree-sitter-sql.wasm'
};

export function normalizeLanguage(lang: string): CodeLanguage | undefined {
	if (!lang) return undefined;
	const l = lang.trim().toLowerCase();
	switch (l) {
		case 'python':
		case 'py':
			return 'python';
		case 'javascript':
		case 'js':
		case 'jsx':
		case 'mjs':
		case 'cjs':
			return 'javascript';
		case 'typescript':
		case 'ts':
		case 'tsx':
			return 'typescript';
		case 'go':
		case 'golang':
			return 'go';
		case 'rust':
		case 'rs':
			return 'rust';
		case 'java':
			return 'java';
		case 'cpp':
		case 'c++':
		case 'cc':
		case 'cxx':
		case 'hpp':
			return 'cpp';
		case 'c':
		case 'h':
			return 'c';
		case 'csharp':
		case 'c#':
		case 'cs':
			return 'csharp';
		case 'ruby':
		case 'rb':
			return 'ruby';
		case 'kotlin':
		case 'kt':
		case 'kts':
			return 'kotlin';
		case 'swift':
			return 'swift';
		case 'php':
		case 'phtml':
		case 'php4':
		case 'php5':
		case 'php7':
		case 'phps':
			return 'php';
		case 'sql':
		case 'pgsql':
		case 'mysql':
		case 'sqlite':
			return 'sql';
		default:
			return undefined;
	}
}

/**
 * Calculates complexity rank from numerical score
 */
export function getComplexityRank(score: number): ComplexityRank {
	if (score <= 5) return 'A';
	if (score <= 10) return 'B';
	if (score <= 20) return 'C';
	if (score <= 30) return 'D';
	if (score <= 40) return 'E';
	return 'F';
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class TreeSitterAnalyzer {
	private static _treeSitterModule: TreeSitterModule | null = null;
	private static _initPromise: Promise<boolean> | null = null;
	private static readonly _languageCache = new Map<CodeLanguage, any>();
	private static _wasmDir: string | null = null;

	/**
	 * Lazy-initialize the Tree-Sitter WASM module and locate pre-compiled binaries
	 */
	private static async _ensureTreeSitter(): Promise<boolean> {
		if (this._treeSitterModule) return true;
		if (this._initPromise) return this._initPromise;

		this._initPromise = (async () => {
			try {
				let fsMod: any = null;
				let pathMod: any = null;

				try {
					if (typeof require !== 'undefined') {
						fsMod = require('fs');
						pathMod = require('path');
					}
				} catch {
					// Fallback when require is not directly in scope
				}

				if (!fsMod || !pathMod) {
					return false;
				}

				// Resolve the directory containing @vscode/tree-sitter-wasm/wasm
				let wasmDir: string | null = null;
				try {
					const mainWasm = require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm');
					wasmDir = pathMod.dirname(mainWasm);
				} catch {
					const candidates = [
						pathMod.resolve('./node_modules/@vscode/tree-sitter-wasm/wasm'),
						pathMod.resolve('../node_modules/@vscode/tree-sitter-wasm/wasm'),
						pathMod.resolve('../../node_modules/@vscode/tree-sitter-wasm/wasm')
					];
					for (const candidate of candidates) {
						if (fsMod.existsSync(pathMod.join(candidate, 'tree-sitter.wasm'))) {
							wasmDir = candidate;
							break;
						}
					}
				}

				if (!wasmDir) return false;
				this._wasmDir = wasmDir;

				// Load tree-sitter.js using an AMD factory bridge
				const treeSitterJsPath = pathMod.join(wasmDir, 'tree-sitter.js');
				if (!fsMod.existsSync(treeSitterJsPath)) return false;

				const code = fsMod.readFileSync(treeSitterJsPath, 'utf8');
				let exported: any = null;
				const defineBridge: any = (deps: any, factory: any) => {
					exported = typeof factory === 'function' ? factory() : deps();
				};
				defineBridge.amd = true;

				const fn = new Function('define', 'require', 'exports', 'module', code);
				fn(defineBridge, require, {}, { exports: {} });

				if (!exported || !exported.Parser) {
					return false;
				}

				await exported.Parser.init({
					locateFile(file: string) {
						return pathMod.join(wasmDir!, file);
					}
				});

				this._treeSitterModule = exported;
				return true;
			} catch (err) {
				return false;
			}
		})();

		return this._initPromise;
	}

	/**
	 * Retrieve or load language grammar
	 */
	private static async _getLanguage(lang: CodeLanguage): Promise<any | null> {
		if (this._languageCache.has(lang)) {
			return this._languageCache.get(lang);
		}

		const ready = await this._ensureTreeSitter();
		if (!ready || !this._treeSitterModule || !this._wasmDir) {
			return null;
		}

		try {
			const fsMod = require('fs');
			const pathMod = require('path');
			const wasmFileName = WASM_FILE_MAP[lang];
			if (!wasmFileName) return null;

			let wasmPath = pathMod.join(this._wasmDir, wasmFileName);
			if (!fsMod.existsSync(wasmPath)) {
				if (lang === 'c') {
					const fallbackCpp = pathMod.join(this._wasmDir, 'tree-sitter-cpp.wasm');
					if (fsMod.existsSync(fallbackCpp)) {
						wasmPath = fallbackCpp;
					} else {
						return null;
					}
				} else {
					return null;
				}
			}

			const wasmBuffer = fsMod.readFileSync(wasmPath);
			const language = await this._treeSitterModule.Language.load(wasmBuffer);
			this._languageCache.set(lang, language);
			return language;
		} catch {
			return null;
		}
	}

	/**
	 * Parse code into a Tree-Sitter AST tree
	 */
	public static async parse(code: string, language: CodeLanguage): Promise<TreeSitterTree | null> {
		const lang = await this._getLanguage(language);
		if (!lang || !this._treeSitterModule) return null;

		try {
			const parser = new this._treeSitterModule.Parser();
			parser.setLanguage(lang);
			return parser.parse(code);
		} catch {
			return null;
		}
	}

	/**
	 * Parse AST and extract symbols
	 */
	public static async parseAST(code: string, language: CodeLanguage): Promise<ASTResult> {
		const tree = await this.parse(code, language);
		if (tree) {
			const symbols: Symbol[] = [];
			this._collectSymbols(tree.rootNode, symbols, '');
			return {
				language,
				tree: { type: tree.rootNode.type, childCount: tree.rootNode.children?.length ?? 0 },
				symbols
			};
		}

		// Fallback heuristic extraction
		return this._heuristicParseAST(code, language);
	}

	private static _collectSymbols(node: TreeSitterNode, out: Symbol[], scope: string) {
		const type = node.type;
		let symbolType: SymbolType | null = null;
		let name = '';
		let signature = '';

		if (this._isFunctionNode(type)) {
			symbolType = 'function';
			name = this._extractNodeName(node);
			signature = node.text.split('\n')[0].trim();
		} else if (this._isClassNode(type)) {
			symbolType = 'class';
			name = this._extractNodeName(node);
			signature = node.text.split('\n')[0].trim();
		} else if (this._isImportNode(type)) {
			symbolType = 'import';
			name = node.text.split('\n')[0].trim();
		} else if (this._isVariableNode(type)) {
			symbolType = 'variable';
			name = this._extractNodeName(node);
		}

		if (symbolType && name) {
			out.push({
				name,
				type: symbolType,
				location: {
					line: node.startPosition.row + 1,
					column: node.startPosition.column,
					endLine: node.endPosition.row + 1,
					endColumn: node.endPosition.column
				},
				scope: scope || undefined,
				signature: signature || undefined
			});
		}

		const nextScope = symbolType === 'class' || symbolType === 'function'
			? (scope ? `${scope}.${name}` : name)
			: scope;

		if (node.children) {
			for (const child of node.children) {
				this._collectSymbols(child, out, nextScope);
			}
		}
	}

	/**
	 * Find a symbol by name
	 */
	public static async findSymbol(code: string, language: CodeLanguage, symbolName: string): Promise<SymbolResult> {
		const lines = code.split('\n');
		const tree = await this.parse(code, language);

		if (tree) {
			const symbols: Symbol[] = [];
			this._collectSymbols(tree.rootNode, symbols, '');
			const match = symbols.find(s => s.name === symbolName);
			if (match) {
				const lineIdx = match.location.line - 1;
				const context = lines[lineIdx] ?? '';
				return {
					found: true,
					name: symbolName,
					type: match.type,
					location: match.location,
					scope: match.scope,
					signature: match.signature,
					context: context.trim()
				};
			}
			return { found: false, name: symbolName };
		}

		// Fallback heuristic search
		return this._heuristicFindSymbol(code, language, symbolName);
	}

	/**
	 * Find all references to a symbol
	 */
	public static async findReferences(code: string, language: CodeLanguage, symbolName: string): Promise<ReferencesResult> {
		const lines = code.split('\n');
		const tree = await this.parse(code, language);

		if (tree) {
			const references: SymbolReference[] = [];
			this._collectReferences(tree.rootNode, null, symbolName, lines, references);
			return {
				symbol: symbolName,
				references,
				count: references.length
			};
		}

		// Fallback heuristic search
		return this._heuristicFindReferences(code, language, symbolName);
	}

	private static _collectReferences(node: TreeSitterNode, parent: TreeSitterNode | null, symbolName: string, lines: string[], out: SymbolReference[]) {
		if (node.text === symbolName && (!node.children || node.children.length === 0)) {
			const line = node.startPosition.row + 1;
			const column = node.startPosition.column;
			const context = (lines[node.startPosition.row] || '').trim();

			// Determine reference classification
			let refType: ReferenceType = 'access';
			const effectiveParent = parent || (node as any).parent;
			const parentType = effectiveParent?.type ?? '';
			if (parentType.includes('call') || parentType.includes('invocation')) {
				refType = 'call';
			} else if (parentType.includes('assignment') || parentType.includes('declarator')) {
				refType = 'assignment';
			} else if (parentType.includes('member') || parentType.includes('attribute') || parentType.includes('field')) {
				refType = 'attribute';
			}

			out.push({ line, column, context, type: refType });
		}

		if (node.children) {
			for (const child of node.children) {
				this._collectReferences(child, node, symbolName, lines, out);
			}
		}
	}

	/**
	 * Extract function signature and docstrings
	 */
	public static async getFunctionSignature(code: string, language: CodeLanguage, functionName: string): Promise<SignatureResult> {
		const tree = await this.parse(code, language);

		if (tree) {
			const funcNode = this._findFunctionNode(tree.rootNode, functionName);
			if (funcNode) {
				const parameters = this._extractParameters(funcNode, language);
				const firstLine = funcNode.text.split('\n')[0].trim();
				const docstring = this._extractDocstring(funcNode, language);

				return {
					found: true,
					name: functionName,
					parameters,
					signature: firstLine,
					docstring: docstring || undefined
				};
			}
			return { found: false, name: functionName };
		}

		// Fallback heuristic
		return this._heuristicGetFunctionSignature(code, language, functionName);
	}

	private static _findFunctionNode(node: TreeSitterNode, name: string): TreeSitterNode | null {
		if (this._isFunctionNode(node.type) && this._extractNodeName(node) === name) {
			return node;
		}
		if (node.children) {
			for (const child of node.children) {
				const found = this._findFunctionNode(child, name);
				if (found) return found;
			}
		}
		return null;
	}

	private static _findParamList(node: TreeSitterNode): TreeSitterNode | null {
		if (
			node.type === 'parameters' ||
			node.type === 'formal_parameters' ||
			node.type === 'parameter_list'
		) {
			return node;
		}
		if (node.children) {
			for (const child of node.children) {
				const found = this._findParamList(child);
				if (found) return found;
			}
		}
		return null;
	}

	private static _extractParameters(funcNode: TreeSitterNode, language: CodeLanguage): FunctionParameter[] {
		const params: FunctionParameter[] = [];
		const paramList = this._findParamList(funcNode);

		if (!paramList || !paramList.children) {
			// Fast parameter string fallback
			const header = funcNode.text.split('{')[0].split(':')[0];
			const match = header.match(/\(([^)]*)\)/);
			if (match && match[1]) {
				const parts = match[1].split(',').map(p => p.trim()).filter(Boolean);
				for (const p of parts) {
					const colonIdx = p.indexOf(':');
					if (colonIdx !== -1) {
						params.push({ name: p.substring(0, colonIdx).trim(), type: p.substring(colonIdx + 1).trim() });
					} else {
						const words = p.split(/\s+/);
						if (words.length > 1) {
							params.push({
								name: words[words.length - 1].replace(/^[*&]+/, '').replace(/^\$/, ''),
								type: words.slice(0, -1).join(' ')
							});
						} else {
							params.push({ name: p.replace(/^\$/, '') });
						}
					}
				}
			}
			return params;
		}

		for (const child of paramList.children) {
			if (child.type === 'identifier') {
				params.push({ name: child.text });
			} else if (
				child.type === 'typed_parameter' ||
				child.type === 'required_parameter' ||
				child.type === 'parameter' ||
				child.type === 'parameter_declaration' ||
				child.type === 'simple_parameter'
			) {
				const idNode =
					child.childForFieldName('declarator') ||
					child.childForFieldName('name') ||
					child.children?.find(c => c.type === 'identifier' || c.type === 'type_identifier');
				const typeNode =
					child.childForFieldName('type') ||
					child.children?.find(c => c.type.includes('type'));
				const rawName = idNode ? this._extractNodeName(idNode) || idNode.text : child.text.split(':')[0].trim();
				params.push({
					name: rawName.replace(/^[*&]+/, '').trim(),
					type: typeNode?.text || undefined
				});
			}
		}

		return params;
	}

	private static _extractDocstring(funcNode: TreeSitterNode, language: CodeLanguage): string | null {
		if (language === 'python') {
			const body = funcNode.childForFieldName('body') || funcNode.children?.find(c => c.type === 'block');
			const firstStatement = body?.children?.[0];
			if (firstStatement && (firstStatement.type === 'expression_statement' || firstStatement.type === 'string')) {
				const text = firstStatement.text.trim();
				if (text.startsWith('"""') || text.startsWith("'''")) {
					return text.slice(3, -3).trim();
				}
			}
		}
		return null;
	}

	/**
	 * Analyze imported modules and dependencies
	 */
	public static async analyzeImports(code: string, language: CodeLanguage): Promise<ImportsResult> {
		const tree = await this.parse(code, language);

		if (tree) {
			const imports: string[] = [];
			this._collectImports(tree.rootNode, language, imports);
			const uniqueImports = Array.from(new Set(imports));
			return {
				language,
				imports: uniqueImports,
				count: uniqueImports.length
			};
		}

		// Fallback heuristic
		return this._heuristicAnalyzeImports(code, language);
	}

	private static _collectImports(node: TreeSitterNode, language: CodeLanguage, out: string[]) {
		const type = node.type;

		if (language === 'python') {
			if (type === 'import_statement' || type === 'import_from_statement') {
				const moduleNode = node.childForFieldName('module_name') || node.children?.find(c => c.type === 'dotted_name');
				if (moduleNode) {
					out.push(moduleNode.text);
				} else {
					const raw = node.text.replace(/^from\s+/, '').replace(/^import\s+/, '').trim();
					out.push(raw.split(/\s+/)[0]);
				}
			}
		} else if (language === 'javascript' || language === 'typescript') {
			if (type === 'import_statement' || type === 'import_declaration') {
				const sourceNode = node.childForFieldName('source') || node.children?.find(c => c.type === 'string' || c.type === 'string_fragment');
				if (sourceNode) {
					out.push(sourceNode.text.replace(/['"`]/g, ''));
				} else {
					const match = node.text.match(/['"]([^'"]+)['"]/);
					if (match) {
						out.push(match[1]);
					}
				}
			}
		} else if (language === 'go') {
			if (type === 'import_declaration' || type === 'import_spec') {
				const pathNode = node.childForFieldName('path') || node.children?.find(c => c.type === 'interpreted_string_literal');
				if (pathNode) {
					out.push(pathNode.text.replace(/['"]/g, ''));
				}
			}
		} else if (language === 'rust') {
			if (type === 'use_declaration') {
				const text = node.text.replace(/^use\s+/, '').replace(/;$/, '').trim();
				out.push(text);
			}
		} else if (language === 'csharp') {
			if (type === 'using_directive') {
				const text = node.text.replace(/^using\s+/, '').replace(/;$/, '').trim();
				out.push(text);
			}
		} else if (language === 'cpp' || language === 'c') {
			if (type === 'preproc_include') {
				const text = node.text.replace(/^#include\s+/, '').trim();
				out.push(text);
			}
		} else if (language === 'java') {
			if (type === 'import_declaration') {
				const text = node.text.replace(/^import\s+/, '').replace(/;$/, '').trim();
				out.push(text);
			}
		} else if (language === 'kotlin') {
			if (type === 'import_header') {
				const text = node.text.replace(/^import\s+/, '').trim();
				if (text) {
					out.push(text);
				}
			}
		} else if (language === 'swift') {
			if (type === 'import_declaration') {
				const text = node.text.replace(/^import\s+/, '').trim();
				if (text) {
					out.push(text);
				}
			}
		} else if (language === 'php') {
			if (type === 'namespace_use_declaration' || type === 'use_declaration') {
				const text = node.text.replace(/^use\s+/, '').replace(/;$/, '').trim();
				if (text) {
					out.push(text);
				}
			}
		} else if (language === 'ruby') {
			if (type === 'call' && (node.text.startsWith('require') || node.text.startsWith('load'))) {
				const match = node.text.match(/['"]([^'"]+)['"]/);
				if (match) {
					out.push(match[1]);
				}
			}
		}

		if (node.children) {
			for (const child of node.children) {
				this._collectImports(child, language, out);
			}
		}
	}

	/**
	 * Analyze cyclomatic and cognitive complexity
	 */
	public static async analyzeComplexity(code: string, language: CodeLanguage): Promise<ComplexityResult> {
		const tree = await this.parse(code, language);
		if (tree) {
			const functions: FunctionComplexity[] = [];
			this._collectFunctionComplexity(tree.rootNode, functions);

			if (functions.length === 0) {
				// Treat whole file as a single unit if no discrete functions are present
				const cyclomatic = 1 + this._countDecisionPoints(tree.rootNode);
				const cognitive = this._calculateCognitiveComplexity(tree.rootNode, 0);
				const rank = getComplexityRank(cyclomatic);
				functions.push({
					name: '<file>',
					cyclomaticComplexity: cyclomatic,
					cognitiveComplexity: cognitive,
					line: 1,
					column: 0,
					complexityRank: rank
				});
			}

			const totalFunctions = functions.length;
			const totalComplexity = functions.reduce((acc, f) => acc + f.cyclomaticComplexity, 0);
			const maxComplexity = Math.max(...functions.map(f => f.cyclomaticComplexity), 0);
			const averageComplexity = totalFunctions > 0 ? Number((totalComplexity / totalFunctions).toFixed(2)) : 0;

			return {
				language,
				functions,
				averageComplexity,
				maxComplexity,
				totalFunctions
			};
		}

		// Fallback heuristic complexity
		return this._heuristicAnalyzeComplexity(code, language);
	}

	private static _collectFunctionComplexity(node: TreeSitterNode, out: FunctionComplexity[]) {
		if (this._isFunctionNode(node.type)) {
			const name = this._extractNodeName(node) || '<anonymous>';
			const cyclomatic = 1 + this._countDecisionPoints(node);
			const cognitive = this._calculateCognitiveComplexity(node, 0);
			const rank = getComplexityRank(cyclomatic);

			out.push({
				name,
				cyclomaticComplexity: cyclomatic,
				cognitiveComplexity: cognitive,
				line: node.startPosition.row + 1,
				column: node.startPosition.column,
				complexityRank: rank
			});
		}

		if (node.children) {
			for (const child of node.children) {
				this._collectFunctionComplexity(child, out);
			}
		}
	}

	private static _countDecisionPoints(node: TreeSitterNode): number {
		let count = 0;
		const type = node.type;

		if (
			type === 'if_statement' ||
			type === 'if_expression' ||
			type === 'elif_clause' ||
			type === 'elseif_clause' ||
			type === 'for_statement' ||
			type === 'for_expression' ||
			type === 'for_in_statement' ||
			type === 'while_statement' ||
			type === 'while_expression' ||
			type === 'repeat_while_statement' ||
			type === 'guard_statement' ||
			type === 'when_expression' ||
			type === 'when_entry' ||
			type === 'switch_case' ||
			type === 'case_clause' ||
			type === 'case_statement' ||
			type === 'match_arm' ||
			type === 'match_expression' ||
			type === 'catch_clause' ||
			type === 'except_clause' ||
			type === 'ternary_expression' ||
			type === 'conditional_expression'
		) {
			count += 1;
		}

		if (type === 'binary_expression' || type === 'boolean_operator') {
			const text = node.text;
			if (text.includes('&&') || text.includes('||') || text.includes(' and ') || text.includes(' or ')) {
				count += 1;
			}
		}

		if (node.children) {
			for (const child of node.children) {
				count += this._countDecisionPoints(child);
			}
		}
		return count;
	}

	private static _calculateCognitiveComplexity(node: TreeSitterNode, nestingLevel: number): number {
		let score = 0;
		const type = node.type;

		const isControlStructure =
			type === 'if_statement' ||
			type === 'for_statement' ||
			type === 'for_in_statement' ||
			type === 'while_statement' ||
			type === 'guard_statement' ||
			type === 'when_expression' ||
			type === 'catch_clause' ||
			type === 'except_clause' ||
			type === 'switch_case';

		if (isControlStructure) {
			score += 1 + nestingLevel;
		}

		const nextNesting = isControlStructure ? nestingLevel + 1 : nestingLevel;

		if (node.children) {
			for (const child of node.children) {
				score += this._calculateCognitiveComplexity(child, nextNesting);
			}
		}
		return score;
	}

	// ---------------- Helper classification ----------------

	private static _isFunctionNode(type: string): boolean {
		return (
			type === 'function_declaration' ||
			type === 'function_definition' ||
			type === 'method_declaration' ||
			type === 'method_definition' ||
			type === 'function_item' ||
			type === 'arrow_function' ||
			type === 'method' ||
			type === 'singleton_method' ||
			type === 'anonymous_function' ||
			type === 'create_function_statement' ||
			type === 'create_procedure_statement' ||
			type === 'procedure_definition'
		);
	}

	private static _isClassNode(type: string): boolean {
		return (
			type === 'class_declaration' ||
			type === 'class_definition' ||
			type === 'struct_item' ||
			type === 'trait_item' ||
			type === 'type_spec' ||
			type === 'class_specifier' ||
			type === 'struct_specifier' ||
			type === 'class' ||
			type === 'module' ||
			type === 'object_declaration' ||
			type === 'protocol_declaration' ||
			type === 'struct_declaration' ||
			type === 'interface_declaration' ||
			type === 'trait_declaration' ||
			type === 'create_table_statement' ||
			type === 'create_view_statement' ||
			type === 'create_schema_statement'
		);
	}

	private static _isVariableNode(type: string): boolean {
		return (
			type === 'variable_declarator' ||
			type === 'let_declaration' ||
			type === 'var_declaration' ||
			type === 'field_declaration' ||
			type === 'property_declaration' ||
			type === 'pattern_binding' ||
			type === 'column_definition' ||
			type === 'declaration'
		);
	}

	private static _isImportNode(type: string): boolean {
		return (
			type === 'import_statement' ||
			type === 'import_from_statement' ||
			type === 'import_declaration' ||
			type === 'import_header' ||
			type === 'use_declaration' ||
			type === 'using_directive' ||
			type === 'namespace_use_declaration' ||
			type === 'preproc_include'
		);
	}

	private static _extractNodeName(node: TreeSitterNode): string {
		const nameNode = node.childForFieldName('name');
		if (nameNode) return nameNode.text;

		const declNode = node.childForFieldName('declarator');
		if (declNode) {
			if (declNode.type === 'identifier' || declNode.type === 'type_identifier' || declNode.type === 'field_identifier') {
				return declNode.text;
			}
			return this._extractNodeName(declNode);
		}

		for (const child of node.children || []) {
			if (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'field_identifier' || child.type === 'simple_identifier' || child.type === 'table_name') {
				return child.text;
			}
			if (child.type === 'function_declarator' || child.type === 'declarator') {
				const nested = this._extractNodeName(child);
				if (nested) return nested;
			}
		}
		return '';
	}

	// ---------------- Heuristic Fallback Engine ----------------

	private static _heuristicParseAST(code: string, language: CodeLanguage): ASTResult {
		const symbols: Symbol[] = [];
		const lines = code.split('\n');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			// SQL Functions / Procedures / Tables
			if (language === 'sql') {
				const sqlFnMatch = trimmed.match(/^(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)/i);
				if (sqlFnMatch) {
					symbols.push({
						name: sqlFnMatch[1],
						type: 'function',
						location: { line: i + 1, column: line.indexOf(sqlFnMatch[1]) },
						signature: trimmed
					});
					continue;
				}

				const sqlTableMatch = trimmed.match(/^CREATE\s+(?:TABLE|VIEW|SCHEMA)\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/i);
				if (sqlTableMatch) {
					symbols.push({
						name: sqlTableMatch[1],
						type: 'class',
						location: { line: i + 1, column: line.indexOf(sqlTableMatch[1]) },
						signature: trimmed
					});
					continue;
				}
			}

			// Functions
			const fnMatch = trimmed.match(/^(?:(?:public|protected|private|static|async|export|default|override|suspend|inline|open|final)\s+)*(?:def|function|fn|func|fun)\s+([a-zA-Z0-9_]+)/);
			if (fnMatch) {
				symbols.push({
					name: fnMatch[1],
					type: 'function',
					location: { line: i + 1, column: line.indexOf(fnMatch[1]) },
					signature: trimmed
				});
				continue;
			}

			// C / C++ functions
			if (language === 'c' || language === 'cpp') {
				const cFnMatch = trimmed.match(/^(?:(?:static|inline|const|extern|virtual)\s+)*(?:void|int|char|short|long|float|double|bool|size_t|ssize_t|uint\d+_t|int\d+_t|[a-zA-Z0-9_]+_t|[A-Z][a-zA-Z0-9_]*)\s*\*?\s*([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{?/);
				if (cFnMatch && cFnMatch[1] !== 'if' && cFnMatch[1] !== 'while' && cFnMatch[1] !== 'for' && cFnMatch[1] !== 'switch') {
					symbols.push({
						name: cFnMatch[1],
						type: 'function',
						location: { line: i + 1, column: line.indexOf(cFnMatch[1]) },
						signature: trimmed
					});
					continue;
				}
			}

			// Classes / Structs / Interfaces / Protocols / Enums
			const classMatch = trimmed.match(/^(?:(?:public|protected|private|static|abstract|sealed|data|open|final|export|default)\s+)*(?:class|struct|interface|type|protocol|object|trait|enum)\s+([a-zA-Z0-9_]+)/);
			if (classMatch) {
				symbols.push({
					name: classMatch[1],
					type: 'class',
					location: { line: i + 1, column: line.indexOf(classMatch[1]) },
					signature: trimmed
				});
				continue;
			}

			// Imports
			if (
				trimmed.startsWith('import ') ||
				trimmed.startsWith('from ') ||
				trimmed.startsWith('using ') ||
				trimmed.startsWith('use ') ||
				trimmed.startsWith('#include ') ||
				trimmed.startsWith('require ') ||
				trimmed.startsWith('require_once ') ||
				trimmed.startsWith('include ') ||
				trimmed.startsWith('include_once ')
			) {
				symbols.push({
					name: trimmed,
					type: 'import',
					location: { line: i + 1, column: line.indexOf(trimmed) }
				});
			}
		}

		return {
			language,
			tree: { type: 'heuristic', lineCount: lines.length },
			symbols
		};
	}

	private static _heuristicFindSymbol(code: string, language: CodeLanguage, symbolName: string): SymbolResult {
		const lines = code.split('\n');
		const escaped = escapeRegex(symbolName);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.includes(symbolName)) {
				let type: SymbolType = 'variable';
				if (
					line.match(new RegExp(`(?:def|function|fn|func|fun)\\s+${escaped}\\b`)) ||
					line.match(new RegExp(`(?:create\\s+(?:or\\s+replace\\s+)?(?:function|procedure))\\s+${escaped}\\b`, 'i')) ||
					line.match(new RegExp(`(?:void|int|char|short|long|float|double|bool|size_t|[a-zA-Z0-9_]+_t)\\s+\\*?\\s*${escaped}\\s*\\(`))
				) {
					type = 'function';
				} else if (
					line.match(new RegExp(`(?:class|struct|interface|type|protocol|object|trait|enum)\\s+${escaped}\\b`)) ||
					line.match(new RegExp(`(?:create\\s+(?:table|view|schema)(?:\\s+if\\s+not\\s+exists)?)\\s+${escaped}\\b`, 'i'))
				) {
					type = 'class';
				}

				return {
					found: true,
					name: symbolName,
					type,
					location: { line: i + 1, column: line.indexOf(symbolName) },
					signature: line.trim(),
					context: line.trim()
				};
			}
		}
		return { found: false, name: symbolName };
	}

	private static _heuristicFindReferences(code: string, language: CodeLanguage, symbolName: string): ReferencesResult {
		const lines = code.split('\n');
		const references: SymbolReference[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			let pos = 0;
			while ((pos = line.indexOf(symbolName, pos)) !== -1) {
				references.push({
					line: i + 1,
					column: pos,
					context: line.trim(),
					type: line.includes(`${symbolName}(`) ? 'call' : 'access'
				});
				pos += symbolName.length;
			}
		}

		return {
			symbol: symbolName,
			references,
			count: references.length
		};
	}

	private static _heuristicGetFunctionSignature(code: string, language: CodeLanguage, functionName: string): SignatureResult {
		const lines = code.split('\n');
		const escaped = escapeRegex(functionName);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const matches =
				line.match(new RegExp(`(?:def|function|fn|func|fun)\\s+${escaped}\\b`)) ||
				line.match(new RegExp(`(?:CREATE\\s+(?:OR\\s+REPLACE\\s+)?)?(?:FUNCTION|PROCEDURE)\\s+${escaped}\\b`, 'i')) ||
				line.match(new RegExp(`(?:void|int|char|short|long|float|double|bool|size_t|[a-zA-Z0-9_]+_t)\\s+\\*?\\s*${escaped}\\s*\\(`));

			if (matches) {
				const paramMatch = line.match(/\(([^)]*)\)/);
				const parameters: FunctionParameter[] = [];
				if (paramMatch && paramMatch[1]) {
					const parts = paramMatch[1].split(',').map(p => p.trim()).filter(Boolean);
					for (const p of parts) {
						const colonIdx = p.indexOf(':');
						if (colonIdx !== -1) {
							parameters.push({
								name: p.substring(0, colonIdx).trim(),
								type: p.substring(colonIdx + 1).trim()
							});
						} else {
							const words = p.split(/\s+/);
							if (words.length > 1) {
								parameters.push({
									name: words[words.length - 1].replace(/^\$/, ''),
									type: words.slice(0, -1).join(' ')
								});
							} else {
								parameters.push({ name: p.replace(/^\$/, '') });
							}
						}
					}
				}

				return {
					found: true,
					name: functionName,
					signature: line,
					parameters
				};
			}
		}
		return { found: false, name: functionName };
	}

	private static _heuristicAnalyzeImports(code: string, language: CodeLanguage): ImportsResult {
		const lines = code.split('\n');
		const imports: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			// Python
			const pyMatch = trimmed.match(/^import\s+([a-zA-Z0-9_.]+)/) || trimmed.match(/^from\s+([a-zA-Z0-9_.]+)\s+import/);
			if (pyMatch) {
				imports.push(pyMatch[1]);
				continue;
			}
			// JS / TS
			const jsMatch = trimmed.match(/(?:from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/);
			if (jsMatch) {
				imports.push(jsMatch[1] || jsMatch[2]);
				continue;
			}
			// C / C++ #include
			const cMatch = trimmed.match(/^#include\s+([<"][^>"]+[>"])/);
			if (cMatch) {
				imports.push(cMatch[1]);
				continue;
			}
			// PHP: use Foo\Bar\Baz; require '...';
			const phpUseMatch = trimmed.match(/^use\s+([a-zA-Z0-9_\\]+);?/);
			if (phpUseMatch) {
				imports.push(phpUseMatch[1]);
				continue;
			}
			const phpReqMatch = trimmed.match(/^(?:require|require_once|include|include_once)\s+['"]([^'"]+)['"]/);
			if (phpReqMatch) {
				imports.push(phpReqMatch[1]);
				continue;
			}
			// Go / Rust / C# / Java / Kotlin / Swift
			const otherMatch = trimmed.match(/^(?:import|using|use)\s+['"]?([a-zA-Z0-9_./\\]+)['"]?;?/);
			if (otherMatch) {
				imports.push(otherMatch[1]);
			}
		}

		const uniqueImports = Array.from(new Set(imports));
		return {
			language,
			imports: uniqueImports,
			count: uniqueImports.length
		};
	}

	private static _heuristicAnalyzeComplexity(code: string, language: CodeLanguage): ComplexityResult {
		const lines = code.split('\n');
		const functions: FunctionComplexity[] = [];

		let fileDecisions = 0;
		for (const line of lines) {
			const trimmed = line.trim();
			if (
				/\b(if|else if|elif|elseif|while|for|foreach|switch|case|when|guard|catch|except)\b/.test(trimmed) ||
				/&&|\|\||\band\b|\bor\b/.test(trimmed)
			) {
				fileDecisions += 1;
			}
		}

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			const fnMatch =
				line.match(/^(?:(?:public|protected|private|static|async|export|default|override|suspend)\s+)*(?:def|function|fn|func|fun)\s+([a-zA-Z0-9_]+)/) ||
				line.match(/^(?:CREATE\s+(?:OR\s+REPLACE\s+)?)?(?:FUNCTION|PROCEDURE)\s+([a-zA-Z0-9_]+)/i) ||
				line.match(/^(?:(?:static|inline)\s+)*(?:void|int|char|short|long|float|double|bool|size_t)\s+\*?\s*([a-zA-Z0-9_]+)\s*\(/);

			if (fnMatch) {
				const fnName = fnMatch[1];
				if (fnName !== 'if' && fnName !== 'while' && fnName !== 'for' && fnName !== 'switch') {
					functions.push({
						name: fnName,
						cyclomaticComplexity: 1 + fileDecisions,
						cognitiveComplexity: fileDecisions,
						line: i + 1,
						column: 0,
						complexityRank: getComplexityRank(1 + fileDecisions)
					});
				}
			}
		}

		if (functions.length === 0) {
			functions.push({
				name: '<file>',
				cyclomaticComplexity: 1 + fileDecisions,
				cognitiveComplexity: fileDecisions,
				line: 1,
				column: 0,
				complexityRank: getComplexityRank(1 + fileDecisions)
			});
		}

		const totalFunctions = functions.length;
		const totalComplexity = functions.reduce((acc, f) => acc + f.cyclomaticComplexity, 0);
		const maxComplexity = Math.max(...functions.map(f => f.cyclomaticComplexity), 0);
		const averageComplexity = totalFunctions > 0 ? Number((totalComplexity / totalFunctions).toFixed(2)) : 0;

		return {
			language,
			functions,
			averageComplexity,
			maxComplexity,
			totalFunctions
		};
	}
}
