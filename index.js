const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const mermaid = import('mermaid');
const tsconfigPath = './tsconfig.json';
const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile).config;
console.log("tsconfig", tsconfig)
// Function to split code into chunks based on maximum size and class/function boundaries
function splitCodeIntoChunks(code, maxSize, filePath) {
  const chunks = [];
  let currentChunk = '';

  // Create a TypeScript compiler host
  const compilerHost = ts.createCompilerHost(tsconfig.compilerOptions, true);

  // Create a TypeScript program
  const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);
  const program = ts.createProgram([sourceFile], tsconfig.compilerOptions, compilerHost);


  let currentNode = sourceFile.getChildAt(0);

  while (currentNode) {
    const nodeText = currentNode.getFullText();
    let nextNode = findNextNode(currentNode, sourceFile);

    const { classes, interfaces, types, enums, functions, imports, exports, components } = parseTypeScriptCode(currentChunk + nodeText, filePath);
    const mermaidDefinition = generateMermaidDefinition(classes, interfaces, types, enums, functions, imports, exports, components);

    if (currentChunk.length + nodeText.length + mermaidDefinition.length <= maxSize) {
      currentChunk += nodeText;
    } else {
      chunks.push({ code: currentChunk.trim(), mermaidDefinition });
      currentChunk = nodeText;
    }

    if (
      (ts.isClassDeclaration(currentNode) || ts.isFunctionDeclaration(currentNode)) &&
      (!nextNode || !nextNode.parent || nextNode.parent !== currentNode.parent)
    ) {
      const { classes, interfaces, types, enums, functions, imports, exports, components, genericTypes } = parseTypeScriptCode(currentChunk, filePath);
      const mermaidDefinition = generateMermaidDefinition(classes, interfaces, types, enums, functions, imports, exports, components);
      chunks.push({ code: currentChunk.trim(), mermaidDefinition });
      currentChunk = '';
    }

    currentNode = nextNode;
  }

  if (currentChunk.length > 0) {
    const { classes, interfaces, types, enums, functions, imports, exports, components } = parseTypeScriptCode(currentChunk, filePath);
    const mermaidDefinition = generateMermaidDefinition(classes, interfaces, types, enums, functions, imports, exports, components);
    chunks.push({ code: currentChunk.trim(), mermaidDefinition });
  }

  return chunks;
}

// Extract generic type parameters
function extractGenericTypes(node) {
  console.log("extractGenericTypes", node?.typeParameters?.map((param) => param.name.text).join(', '));
  if (node.typeParameters) {
    return `<${node.typeParameters.map((param) => param.name.text).join(', ')}>`;
  }
  return '';
}

function findNextNode(node, sourceFile) {
  let nextNode = ts.findNextToken(node, sourceFile, sourceFile);
  if (!nextNode) {
    let parent = node.parent;
    while (parent && !nextNode) {
      nextNode = ts.findNextToken(parent, sourceFile, sourceFile);
      parent = parent.parent;
    }
  }
  return nextNode;
}

function getFunctionFromNode(node, label) {
  const functionName = node.name?.getText?.() ?? label ?? 'anonymous';;
  const parameters = node.parameters.map((param) => {
    const paramType = extractType(param.type).flat();
    if (ts.isObjectBindingPattern(param.name)) {
      const elements = param.name.elements.map((element) => {
        const name = element.name.getText();
        // const type = paramType === name ? paramType : 'any';
        const type = paramType.find((prop) => prop.name === name)?.type || 'any';
        return { name, type };
      });
      return elements;
    } else {
      const paramName = param.name.getText();
      return { name: paramName, type: paramType };
    }
  }).flat();
  let returnType = node.type ? extractType(node.type).flat() : null;
  if (!returnType || !returnType.length) {
    returnType = inferReturnType(node)?.[0]
  }
  const genericTypes = extractGenericTypes(node);

  return { name: functionName, parameters, returnType, genericTypes }
}

function isUsingImportedVariables(functionNode, sourceFile, checker, compilerOptions) {
  const importedSymbols = [];

  // Collect imported symbols and their paths
  ts.forEachChild(sourceFile, (node) => {
    if (ts.isImportDeclaration(node)) {
      const importClause = node.importClause;
      if (importClause && importClause.namedBindings) {
        const namedBindings = importClause.namedBindings;
        if (ts.isNamedImports(namedBindings)) {
          namedBindings.elements.forEach((element) => {
            const importedSymbol = checker.getSymbolAtLocation(element.name);
            if (importedSymbol) {
              const importPath = (node.moduleSpecifier).text;
              importedSymbols.push({ symbol: importedSymbol, path: importPath });
            }
          });
        }
      }
    }
  });

  const usedImportPaths = [];

  function visit(node) {
    if (ts.isIdentifier(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      if (symbol) {
        const importInfo = importedSymbols.find((info) => info.symbol === symbol);
        if (importInfo) {
          const resolvedModule = ts.resolveModuleName(importInfo.path, sourceFile.fileName, compilerOptions, ts.sys);
          if (resolvedModule?.resolvedModule) {
            const fullPath = resolvedModule.resolvedModule.resolvedFileName;
            if (!usedImportPaths.includes(fullPath)) {
              usedImportPaths.push(fullPath);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  ts.forEachChild(functionNode.body, visit);

  return usedImportPaths;
}


function getFileAndImportForNode(node, sourceFile, checker) {
  let currentNode = node;
  while (currentNode && currentNode.kind !== ts.SyntaxKind.SourceFile) {
    if (currentNode.kind === ts.SyntaxKind.ImportDeclaration) {
      const importDeclaration = currentNode;
      const importClause = importDeclaration.importClause;
      if (importClause && importClause.namedBindings) {
        const namedBindings = importClause.namedBindings;
        if (namedBindings.kind === ts.SyntaxKind.NamedImports) {
          const namedImports = namedBindings;
          const importSpecifier = namedImports.elements.find(element => element.name.text === node.getName());
          if (importSpecifier) {
            const importSymbol = checker.getSymbolAtLocation(importSpecifier);
            if (importSymbol) {
              const importDeclarationFile = importSymbol.declarations[0].getSourceFile().fileName;
              return { file: importDeclarationFile, import: importDeclaration.moduleSpecifier.getText() };
            }
          }
        }
      }
    }
    currentNode = currentNode.parent;
  }
  return { file: sourceFile.fileName, import: undefined };
}

// Extractor functions for the knowledge graph
function getFileDetails(sourceFile) {
  return sourceFile.fileName; // Returns the file path
}

function getClassDetails(checker, sourceFile) {
  const classes = [];
  sourceFile.forEachChild(node => {
    if (node.kind === ts.SyntaxKind.ClassDeclaration) {
      const functions = getFunctionDetails(node)
      node.name.text && classes.push({
        name: node.name?.text, // Class name
        members: functions
      });
    }
  });
  return classes;
}

function getFunctionDetails(sourceFile) {
  const functions = [];
  sourceFile.forEachChild(node => {
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionLike(node)) {
      node.name?.text && functions.push({
        name: node.name.text, // Function name
      });
    }
  });
  return functions;
}

function getNodePath(program, compilerHost, sourceFile, node) {
  const moduleSpecifier = node.moduleSpecifier
  let resolvedFileName;
  if (ts.isStringLiteral(moduleSpecifier)) {
    const importPath = moduleSpecifier.text;
    const resolvedModule = ts.resolveModuleName(importPath, sourceFile.fileName, program.getCompilerOptions(), compilerHost);

    if (resolvedModule?.resolvedModule) {
      resolvedFileName = resolvedModule.resolvedModule.resolvedFileName;
      console.log(`Import "${importPath}" resolved to file: ${resolvedFileName}`);
    } else {
      resolvedFileName = importPath.replace(/['"]/g, '');
      console.log(`Import "${importPath}" could not be resolved. Using ${resolvedFileName}.`, importPath, sourceFile.fileName);
    }
  }
  return resolvedFileName;
}

function getImportDetails(program, compilerHost, sourceFile) {
  const imports = [];
  sourceFile.forEachChild((node) => {
    if (node.kind === ts.SyntaxKind.ImportDeclaration) {
      let resolvedFileName = getNodePath(program, compilerHost, sourceFile, node)

      if (node.importClause) {
        if (node.importClause.name) {
          imports.push(node.importClause.name.getText());
        }

        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            node.importClause.namedBindings.elements.forEach((element) => {
              imports.push({
                variableName: element.name.getText(),
                fileName: resolvedFileName,
              });
            });
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            imports.push({ name: node.importClause.namedBindings.name.getText(), fileName: resolvedFileName });
          }
        }
      }
    }
  });
  return imports;
}

function handleExportDeclaration(node, arr) {
  if (ts.isExportDeclaration(node) && node.exportClause?.elements) {
    node.exportClause.elements.forEach(e => arr.push({ name: e.getText(), type: "variable" }));
  } else if (ts.isStringLiteral(node.moduleSpecifier)) {
    arr.push({ name: `* as ${node.moduleSpecifier.text}`, type: "module" });
  }
}

function handleExportedVariable(decl, arr) {
  const name = decl.name.getText();
  const initializer = decl.initializer;

  if (initializer) {
    const details = extractValue(initializer, name);
    if (details) {
      arr.push({ ...details, name });
    }
  }
}

function handleDefaultExportDeclaration(node, arr) {
  if (ts.isFunctionDeclaration(node) && node?.name?.text !== "") {
    arr.push({ name: node.name.text ?? 'anonymous', type: "function" });
  } else if (ts.isVariableDeclaration(node)) {
    arr.push({ name: "default", type: "variable" });
  }
}

function isExportDeclaration(node) {
  return ts.isExportDeclaration(node);
}

function isExportedVariableStatement(node) {
  return ts.isVariableStatement(node) && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
}

function isDefaultExportDeclaration(node) {
  return node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) &&
    node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
}

function extractValue(initializer, varName) {
  if (!initializer) return;

  if (ts.isIdentifier(initializer)) return { type: "variable", value: initializer.getText() };
  else if (ts.isStringLiteral(initializer)) return { type: 'string', value: initializer.text };
  else if (ts.isNumericLiteral(initializer)) {
    const value = initializer.numberValue; // Assuming the existence of numberValue for simplicity
    return { type: typeof value, value };
  }

  return null;
}

// Main function
function getExportDetails(sourceFile) {
  const exports = [];
  sourceFile.forEachChild((node) => {
    if (isExportDeclaration(node)) {
      handleExportDeclaration(node, exports);
    } else if (isExportedVariableStatement(node)) {
      node.declarationList.declarations.forEach(decl => handleExportedVariable(decl, exports));
    } else if (isDefaultExportDeclaration(node)) {
      handleDefaultExportDeclaration(node, exports);
    }
  });

  return exports;
}

function isDefaultImport(imp) {
  return !!imp.moduleSpecifier && imp.importClause?.name &&
    ts.isStringLiteralLike(imp.moduleSpecifier) &&
    ts.isIdentifier(imp.importClause.name);
}

function getVariableUsages(program, compilerHost, sourceFile) {
  console.log(`\nDebugging for file: ${sourceFile.fileName}`);

  const usages = [];
  let variables = {}; // Initialize but with a broader type

  sourceFile.forEachChild((node) => {
    if (ts.isImportDeclaration(node)) {
      let resolvedFileName = getNodePath(program, compilerHost, sourceFile, node)
      if (isDefaultImport(node)) {
        console.log(`Found import: ${node.moduleSpecifier.text} as ${node.importClause.name.text}`);
        const variableName = node.importClause.name.text;

        variables[variableName] = {
          importPath: resolvedFileName,
          importSource: node.moduleSpecifier.text,
        };
      } else {
        handleNamedImports(node, variables, resolvedFileName);
      }
    } else if (variables && ts.isVariableStatement(node)) {
      console.log(`Processing variable statement: ${node.getText()}`);
      node.declarationList.declarations.forEach((decl) => {
        if (ts.isIdentifier(decl.name)) {
          const varName = decl.name.text;
          variables[varName] && variables[varName].usageCount++;
          console.log(`Found usage of ${varName}`);
        }
      });
    }
  });

  console.log('Final Variables: ', variables);

  for (const varName in variables) {
    usages.push(variables[varName]);
  }

  return usages;
}

function handleNamedImports(imp, vars, importPath) {
  console.log(`Found named imports in ${imp.moduleSpecifier.text}`);
  if (imp?.importClause?.namedBindings) {
    imp.importClause.namedBindings.forEachChild((binding) => {
      if (binding.name && ts.isIdentifier(binding.name)) {
        const variableName = binding.name.text;
        vars[variableName] = {
          importPath,
          importSource: imp.moduleSpecifier.text,
        };
      }
    });
  }
}

function extractDetails(program, compilerHost, checker, sourceFile) {
  const file = getFileDetails(sourceFile);
  const classes = getClassDetails(checker, sourceFile);
  const functions = getFunctionDetails(sourceFile);
  const imports = getImportDetails(program, compilerHost, sourceFile);
  const exports = getExportDetails(sourceFile);
  const usages = getVariableUsages(program, compilerHost, sourceFile, imports);

  return { file, classes, functions, imports, exports, usages };
}


// Function to parse TypeScript code and extract detailed information
function parseTypeScriptCode(code, filePath, rootPath, cache) {
  const classes = [];
  const interfaces = [];
  const types = [];
  const enums = [];
  const functions = [];
  const imports = [];
  const exports = [];
  const components = [];

  console.log("Parsing code", filePath)
  const fileExtension = path.extname(filePath);
  const scriptKind = fileExtension === '.tsx' || fileExtension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const virtualFileName = `temp${fileExtension}`;

  const tsconfigPath = './tsconfig.json';
  const tsconfig = ts.readConfigFile(tsconfigPath, ts.sys.readFile).config;
  const compilerHost = ts.createCompilerHost(tsconfig, true);
  const parsedConfig = ts.parseJsonConfigFileContent(tsconfig, ts.sys, './');
  const compilerOptions = parsedConfig.options;

  const program = ts.createProgram([filePath], compilerOptions, compilerHost);
  const checker = program.getTypeChecker();

  program.getSourceFiles().forEach((sourceFile, i) => {
    if (cache[sourceFile.fileName]) {
      return
    }
    const { file, classes, functions, imports, exports, usages } = extractDetails(program, compilerHost, checker, sourceFile);
    cache[file] = { classes, functions, imports, exports, usages }
  });

  return cache[filePath]
}

// Function to check if a node represents a React component
function isReactComponent(node) {
  // Check if the node is a function declaration or a variable declaration with a function expression
  if (ts.isFunctionDeclaration(node) || (ts.isVariableStatement(node) && node.declarationList.declarations.some(isFunctionExpression))) {
    // Check if the function returns JSX elements or React.createElement calls
    const body = node.body;
    if (body && ts.isBlock(body)) {
      return body.statements.some(isJSXElement);
    }
  }
  return false;
}

// Function to check if a node is a function expression
function isFunctionExpression(declaration) {
  return declaration.initializer && ts.isArrowFunction(declaration.initializer);
}

// Function to check if a node is a JSX element
function isJSXElement(node) {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function extractValue(node, label) {
  if (!node) {
    return undefined;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const properties = {};
    node.properties.forEach((property) => {
      if (ts.isPropertyAssignment(property)) {
        const name = property.name.getText();
        const value = extractValue(property.initializer, label);
        properties[name] = value;
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const name = property.name.getText();
        const value = extractValue(property.name, label);
        properties[name] = value;
      }
    });
    return { kind: 'variable', type: 'property', value: properties };
  } else if (ts.isArrayLiteralExpression(node)) {
    return { kind: 'variable', type: 'array', value: node.elements.map((element) => extractValue(element, label)) };
  } else if (ts.isStringLiteral(node)) {
    return { kind: 'variable', type: 'string', value: node.text };
  } else if (ts.isNumericLiteral(node)) {
    return { kind: 'variable', type: 'number', value: Number(node.text) };
  } else if (ts.isBooleanLiteral(node)) {
    return { kind: 'variable', type: 'boolean', value: node.kind === ts.SyntaxKind.TrueKeyword };
  } else if (ts.isIdentifier(node)) {
    return { kind: 'variable', type: 'identifier', value: node.getText() };
  } else if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const nodeValue = getFunctionFromNode(node, label);
    console.log("extractValue ts.isArrowFunction(node) || ts.isFunctionExpression(node)", nodeValue)

    return { kind: 'variable', type: 'function', value: nodeValue };
  } else {
    return undefined;
  }
}

// Function to extract React component props
function extractReactProps(node) {
  const props = [];
  if (ts.isFunctionDeclaration(node)) {
    node.parameters.forEach((param) => {
      if (ts.isParameter(param) && param.type) {
        const paramType = extractType(param.type).flat();
        console.log("Returning prop type", paramType, param.name.text)
        props.push({ name: param.name.text, type: paramType });
      }
    });
  } else if (ts.isVariableStatement(node)) {
    node.declarationList.declarations.forEach((declaration) => {
      if (isFunctionExpression(declaration) && declaration.initializer.parameters) {
        declaration.initializer.parameters.forEach((param) => {
          if (ts.isParameter(param) && param.type) {
            const paramType = extractType(param.type).flat();
            console.log("Returning prop type", paramType, param.name.text)
            props.push({ name: param.name.text, type: paramType });
          }
        });
      }
    });
  }
  return props;
}

// Function to extract the type from a node
// Returns string[] of types
function extractType(node) {
  if (!node) {
    return ['any'];
  }

  if (ts.isTypeLiteralNode(node)) {
    console.log("isTypeLiteral")
    const properties = node.members
      .filter(ts.isPropertySignature)
      .map((member) => ({
        name: member.name.getText(),
        type: extractType(member.type).flat(),
      }));
    console.log("returning", properties, node?.name, node?.typeName)
    return properties;
  } else if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText();
    const typeArguments = node.typeArguments
      ? node.typeArguments.map(extractType)
      : [];
    if (typeArguments && typeArguments.length > 0) {
      console.log("isTypeReferenceNode", typeName, typeArguments)
      return [`${typeName}<${typeArguments.map(JSON.stringify).join(', ')}>`];
    } else {
      console.log("isTypeReferenceNode", typeName)
      return [typeName];
    }
  } else if (ts.isArrayTypeNode(node)) {
    const elementType = extractType(node.elementType).flat();
    console.log("isArrayTypeNode", elementType)
    return elementType;
  } else if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
    return node.types.map(extractType).flat();
  } else if (node.getText()) {
    console.log("else getText", node?.name, node.getText())
    return [node.getText()];
  }

  console.log('nononono', node)
}

// Helper function to infer the return type of a function
function inferReturnType(node) {
  const returnStatement = findReturnStatement(node);
  if (returnStatement) {
    const returnExpression = returnStatement.expression;
    if (returnExpression) {
      return extractType(returnExpression).flat();
    }
  }
  return ['void'];
}

// Helper function to find the return statement within a function
function findReturnStatement(node) {
  let returnStatement = null;
  ts.forEachChild(node, (child) => {
    if (ts.isReturnStatement(child)) {
      returnStatement = child;
    } else if (ts.isBlock(child)) {
      returnStatement = findReturnStatement(child);
    }
  });
  return returnStatement;
}

// Function to generate Mermaid definition
function generateMermaidDefinition(classes, interfaces, types, enums, functions, imports, exports, components) {
  let mermaidDefinition = 'classDiagram\n';

  // Add classes to the diagram
  classes.forEach((classObj) => {
    mermaidDefinition += `class ${classObj.name}${classObj.genericTypes} {\n`;
    if (classObj.properties) {
      classObj.properties.forEach((property) => {
        mermaidDefinition += `  ${property}\n`;
      });
    }
    if (classObj.methods) {
      classObj.methods.forEach((method) => {
        mermaidDefinition += `  ${method}\n`;
      });
    }
    mermaidDefinition += '}\n';

    // Add class relationships
    if (classObj.dependencies) {
      classObj.dependencies.forEach((dependency) => {
        mermaidDefinition += `${classObj.name} --> ${dependency}\n`;
      });
    }

    if (classObj.usages) {
      classObj.usages.forEach((usage) => {
        mermaidDefinition += `${classObj.name} <.. ${usage}\n`;
      });
    }
  });

  // Add interfaces to the diagram
  interfaces.forEach((interfaceObj) => {
    mermaidDefinition += `class ${interfaceObj.name}${interfaceObj.genericTypes} {\n<<interface>>`;
    if (interfaceObj.properties) {
      interfaceObj.properties.forEach((property) => {
        mermaidDefinition += `  +${property}\n`;
      });
    }
    if (interfaceObj.methods) {
      interfaceObj.methods.forEach((method) => {
        mermaidDefinition += `  +${method}()\n`;
      });
    }
    mermaidDefinition += '}\n';

    // Add interface relationships
    if (interfaceObj.dependencies) {
      interfaceObj.dependencies.forEach((dependency) => {
        mermaidDefinition += `${interfaceObj.name} --|> ${dependency}\n`;
      });
    }

    if (interfaceObj.usages) {
      interfaceObj.usages.forEach((usage) => {
        mermaidDefinition += `${interfaceObj.name} <.. ${usage}\n`;
      });
    }
  });
  // Add types to the diagram
  if (types) {
    types.forEach((typeObj) => {
      mermaidDefinition += `class ${typeObj.name} {\n`;
      mermaidDefinition += `  ${typeObj.definition}\n`;
      mermaidDefinition += '}\n';
    });
  }

  // Add enums to the diagram
  enums.forEach((enumObj) => {
    mermaidDefinition += `enum ${enumObj.name} {\n`;
    enumObj.members.forEach((member) => {
      mermaidDefinition += `  ${member}\n`;
    });
    mermaidDefinition += '}\n';
  });

  // Add functions with parameters
  functions.forEach((func) => {
    mermaidDefinition += `<<function>> ${func.name}${func.genericTypes}(${func.parameters}): ${func.returnType}\n`;
  });


  // Add import relationships
  imports.forEach((importObj) => {
    const importPath = importObj.path.replace(/\./g, '_');
    importObj.names.forEach((name) => {
      mermaidDefinition += `${name} --> ${importPath}\n`;
    });
    if (importObj.defaultImport) {
      mermaidDefinition += `${importObj.defaultImport} --> ${importPath}\n`;
    }
  });

  // Add export relationships
  exports.forEach((exportName) => {
    mermaidDefinition += `${exportName} --> [Export]\n`;
  });

  if (components.length > 0) {
    mermaidDefinition += '\n\n// React Components\n';
    components.forEach((component) => {
      mermaidDefinition += `class ${component.name} {\n`;
      component.props.forEach((prop) => {
        mermaidDefinition += `  ${prop}\n`;
      });
      mermaidDefinition += '}\n';
    });
  }
  // Check if the Mermaid definition is empty
  if (mermaidDefinition.trim() === 'classDiagram') {
    return '';
  }
  return mermaidDefinition;
}

const ignorePaths = ['dist', '.next', '.d.ts'];
// Function to recursively process TypeScript files in a directory
async function processDirectory(directory, maxContextSize, outputFile, onlyMermaid = false) {
  const files = await fs.promises.readdir(directory);

  for (const file of files) {
    const isOnlyMermaid = onlyMermaid || file === 'node_modules';
    const filePath = path.join(directory, file);
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      // Recursively process subdirectories
      if (ignorePaths.includes(file)) continue;
      await processDirectory(filePath, maxContextSize, outputFile, isOnlyMermaid);
    } else if (stats.isFile() && (!ignorePaths.includes(file)) && (path.extname(file) === '.ts' || path.extname(file) === '.js' || path.extname(file) === '.tsx' || path.extname(file) === '.jsx')) {
      // Process TypeScript files
      const code = await fs.promises.readFile(filePath, 'utf-8');
      const codeChunks = splitCodeIntoChunks(code, maxContextSize, filePath);

      for (let index = 0; index < codeChunks.length; index++) {
        const chunk = codeChunks[index];
        try {
          // Directly output the Mermaid markdown text instead of converting to SVG
          const mermaidMarkdown = chunk.mermaidDefinition;
          // Create a JSON object with the chunked code and Mermaid markdown
          const jsonData = {
            file: filePath,
            chunk: index + 1,
            code: isOnlyMermaid ? "" : chunk.code,
            mermaidMarkdown: mermaidMarkdown,
          };
          // Append the JSON data to the output file
          await fs.promises.appendFile(outputFile, JSON.stringify(jsonData) + '\n');
        } catch (error) {
          console.error('Error processing Mermaid markdown:', error);
        }
      }
    }
  }
}
// Usage example
const directoryPath = '/home/acidhax/dev/originals/dataset-manager-nextjs/'; // Replace with the path to your TypeScript directory
const maxContextSize = 8000; // Specify the maximum context size in characters

// if (mermaid?.initialize) {
//   // Initialize Mermaid
//   mermaid.initialize({
//     startOnLoad: true,
//   });
// }

// chunkTypeScriptFiles(directoryPath, maxContextSize);
// processDirectory(directoryPath, maxContextSize, 'crawled.jsonl');

(async () => {
  try {
    const filePath = '/home/acidhax/dev/originals/dataset-manager-nextjs/src/app/page.tsx';
    const code = await fs.promises.readFile(filePath, 'utf-8');
    const parsedData = parseTypeScriptCode(code, filePath);
    console.log(JSON.stringify(parsedData, null, 2));
  } catch (error) {
    console.error('Failed to test parseTypeScriptCode:', error);
  }
})();


module.exports = {
  parseTypeScriptCode,
  splitCodeIntoChunks,
}