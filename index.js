import fs from 'fs';

import path from 'path';
import ts from 'typescript';
import mermaid from 'mermaid';

// Function to split code into chunks based on maximum size and class/function boundaries
function splitCodeIntoChunks(code, maxSize, filePath) {
  const chunks = [];
  let currentChunk = '';

  const sourceFile = ts.createSourceFile('temp.ts', code, ts.ScriptTarget.Latest, true);
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

// Function to parse TypeScript code and extract detailed information
function parseTypeScriptCode(code, filePath) {
  const fileExtension = path.extname(filePath);
  const scriptKind = fileExtension === '.tsx' || fileExtension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile('temp' + fileExtension, code, ts.ScriptTarget.Latest, true, scriptKind);

  const classes = [];
  const interfaces = [];
  const types = [];
  const enums = [];
  const functions = [];
  const imports = [];
  const exports = [];
  const components = [];

  // Traverse the AST and extract detailed information
  ts.forEachChild(sourceFile, (node) => {
    // Extract class and interface relationships
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      const classDependencies = [];
      const properties = [];
      const methods = [];
      const genericTypes = extractGenericTypes(node);

      // Find class dependencies (imports, extends, implements)
      node.heritageClauses?.forEach((clause) => {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword || clause.token === ts.SyntaxKind.ImplementsKeyword) {
          clause.types.forEach((type) => {
            const dependencyName = type.expression.getText();
            classDependencies.push(dependencyName);
          });
        }
      });

      // Extract class properties
      node.members.forEach((member) => {
        if (ts.isPropertyDeclaration(member) && member.name) {
          const propertyName = member.name.getText();
          const propertyType = member.type ? member.type.getText() : 'any';
          properties.push(`${propertyName}: ${propertyType}`);
        } else if (ts.isMethodDeclaration(member) && member.name) {
          const methodName = member.name.getText();
          const parameters = member.parameters.map((param) => {
            const paramName = param.name.getText();
            const paramType = param.type ? param.type.getText() : 'any';
            return `${paramName}: ${paramType}`;
          });
          const returnType = member.type ? member.type.getText() : 'void';
          methods.push(`${methodName}(${parameters.join(', ')}): ${returnType}`);
        }
      });

      classes.push({ name: className, properties, methods, dependencies: classDependencies, genericTypes });

    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      const interfaceName = node.name.text;
      const interfaceDependencies = [];
      const properties = [];
      const methods = [];

      // Find interface dependencies (extends)
      node.heritageClauses?.forEach((clause) => {
        if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
          clause.types.forEach((type) => {
            const dependencyName = type.expression.getText();
            interfaceDependencies.push(dependencyName);
          });
        }
      });

      // Extract interface properties and methods
      node.members.forEach((member) => {
        if (ts.isPropertySignature(member) && member.name) {
          const propertyName = member.name.getText();
          const propertyType = member.type ? member.type.getText() : 'any';
          properties.push(`${propertyName}: ${propertyType}`);
        } else if (ts.isMethodSignature(member) && member.name) {
          const methodName = member.name.getText();
          const parameters = member.parameters.map((param) => {
            const paramName = param.name.getText();
            const paramType = param.type ? param.type.getText() : 'any';
            return `${paramName}: ${paramType}`;
          });
          const returnType = member.type ? member.type.getText() : 'void';
          methods.push(`${methodName}(${parameters.join(', ')}): ${returnType}`);
        }
      });
      const genericTypes = extractGenericTypes(node);
      interfaces.push({ name: interfaceName, properties, methods, dependencies: interfaceDependencies, genericTypes });
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      const typeName = node.name.text;
      const typeDefinition = node.type.getText();
      types.push({ name: typeName, definition: typeDefinition });
    } else if (ts.isEnumDeclaration(node) && node.name) {
      const enumName = node.name.text;
      const members = node.members.map((member) => member.name.getText());
      enums.push({ name: enumName, members });
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      const functionName = node.name.text;
      const parameters = node.parameters.map((param) => {
        const paramName = param.name.getText();
        const paramType = param.type ? param.type.getText() : 'any';
        return `${paramName}: ${paramType}`;
      });
      const returnType = node.type ? node.type.getText() : 'void';
      const genericTypes = extractGenericTypes(node);
      functions.push({ name: functionName, parameters: parameters.join(', '), returnType, genericTypes });
    } else if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
      const componentName = node.name?.text;
      if (componentName && isReactComponent(node)) {
        const props = extractReactProps(node);
        const genericTypes = extractGenericTypes(node);
        components.push({ name: componentName, props, genericTypes });
      }
    } else if (ts.isImportDeclaration(node)) {
      const importPath = node.moduleSpecifier.getText().replace(/['"]/g, '');
      const importNames = [];
      let defaultImport = '';

      if (node.importClause) {
        if (node.importClause.name) {
          defaultImport = node.importClause.name.getText();
        }

        if (node.importClause.namedBindings) {
          if (ts.isNamedImports(node.importClause.namedBindings)) {
            node.importClause.namedBindings.elements.forEach((element) => {
              importNames.push(element.name.getText());
            });
          } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
            importNames.push(node.importClause.namedBindings.name.getText());
          }
        }
      }

      imports.push({ path: importPath, names: importNames, defaultImport });
    } else if (ts.isExportDeclaration(node)) {
      if (node.exportClause && node.exportClause.elements) {
        node.exportClause.elements.forEach((element) => {
          exports.push(element.name.getText());
        });
      }
    }
  });

  // Extract usage relationships
  classes.forEach((classObj) => {
    const classUsages = [];

    // Find class usages in other classes, interfaces, and functions
    sourceFile.forEachChild((node) => {
      if (ts.isClassDeclaration(node) && node.name && node.name.text !== classObj.name) {
        const otherClassName = node.name.text;
        if (node.heritageClauses?.some((clause) => clause.types.some((type) => type.expression.getText() === classObj.name))) {
          classUsages.push(otherClassName);
        }
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        const interfaceName = node.name.text;
        if (node.heritageClauses?.some((clause) => clause.types.some((type) => type.expression.getText() === classObj.name))) {
          classUsages.push(interfaceName);
        }
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        if (node.parameters.some((param) => param.type?.getText() === classObj.name)) {
          classUsages.push(functionName);
        }
      }
    });

    classObj.usages = classUsages;
  });

  interfaces.forEach((interfaceObj) => {
    const interfaceUsages = [];

    // Find interface usages in classes and functions
    sourceFile.forEachChild((node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        const className = node.name.text;
        if (node.heritageClauses?.some((clause) => clause.types.some((type) => type.expression.getText() === interfaceObj.name))) {
          interfaceUsages.push(className);
        }
      } else if (ts.isFunctionDeclaration(node) && node.name) {
        const functionName = node.name.text;
        if (node.parameters.some((param) => param.type?.getText() === interfaceObj.name)) {
          interfaceUsages.push(functionName);
        }
      }
    });

    interfaceObj.usages = interfaceUsages;
  });

  return { classes, interfaces, types, enums, functions, imports, exports, components };
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

// Function to extract React component props
function extractReactProps(node) {
  const props = [];
  if (ts.isFunctionDeclaration(node)) {
    node.parameters.forEach((param) => {
      if (ts.isParameter(param) && param.type) {
        props.push(param.name.text + ': ' + param.type.getText());
      }
    });
  } else if (ts.isVariableStatement(node)) {
    node.declarationList.declarations.forEach((declaration) => {
      if (isFunctionExpression(declaration) && declaration.initializer.parameters) {
        declaration.initializer.parameters.forEach((param) => {
          if (ts.isParameter(param) && param.type) {
            props.push(param.name.text + ': ' + param.type.getText());
          }
        });
      }
    });
  }
  return props;
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
    mermaidDefinition += `interface ${interfaceObj.name}${interfaceObj.genericTypes} {\n`;
    if (interfaceObj.properties) {
      interfaceObj.properties.forEach((property) => {
        mermaidDefinition += `  ${property}\n`;
      });
    }
    if (interfaceObj.methods) {
      interfaceObj.methods.forEach((method) => {
        mermaidDefinition += `  ${method}\n`;
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

// Function to recursively process TypeScript files in a directory
async function processDirectory(directory, maxContextSize, outputFile, onlyMermaid = false) {
  const files = await fs.promises.readdir(directory);

  for (const file of files) {
    // Skip node_modules and .next directories
    if (file === '.next') continue
    const isOnlyMermaid = onlyMermaid || file === 'node_modules';

    const filePath = path.join(directory, file);
    const stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      // Recursively process subdirectories
      await processDirectory(filePath, maxContextSize, outputFile, isOnlyMermaid);
    } else if (stats.isFile() && (path.extname(file) === '.ts' || path.extname(file) === '.js' || path.extname(file) === '.tsx')) {
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

// Initialize Mermaid
mermaid.initialize({
  startOnLoad: true,
});

// chunkTypeScriptFiles(directoryPath, maxContextSize);
processDirectory(directoryPath, maxContextSize, 'crawled.jsonl');

