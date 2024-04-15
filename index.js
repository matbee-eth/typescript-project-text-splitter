const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const mermaid = import('mermaid');

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
  console.log("getFunctionFromNode isFunctionDeclaration", node?.name, label)
  const functionName = node.name?.getText?.() ?? label ?? 'anonymous';;
  const parameters = node.parameters.map((param) => {
    const paramType = extractType(param.type);
    if (ts.isObjectBindingPattern(param.name)) {
      const elements = param.name.elements.map((element) => {
        const name = element.name.getText();
        console.info("paramType", paramType)
        const type = paramType === name ? paramType : 'any';
        return { name, type };
      });
      return elements;
    } else {
      const paramName = param.name.getText();
      return { name: paramName, type: paramType };
    }
  }).flat();
  let returnType = node.type ? extractType(node.type) : null;
  if (!returnType) {
    returnType = inferReturnType(node)
  }
  console.log("getFunctionFromNode returnType", returnType, typeof returnType)
  const genericTypes = extractGenericTypes(node);
  console.log("getFunctionFromNode returnType??", JSON.stringify(returnType))
  return { name: functionName, parameters, returnType, genericTypes }
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
            return { name: paramName, type: paramType };
          });
          console.log("returnType??", member.type, member.type.getText())
          const returnType = member.type ? member.type.getText() : 'void';
          methods.push({
            name: methodName,
            parameters,
            returnType,
          });
        }
      });

      classes.push({ name: className, properties, methods, dependencies: classDependencies, genericTypes });

    }
    if (ts.isInterfaceDeclaration(node) && node.name) {
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
    }
    if (ts.isTypeAliasDeclaration(node) && node.name) {
      const typeName = node.name.text;
      const typeDefinition = node.type.getText();
      types.push({ name: typeName, definition: typeDefinition });
    } else if (ts.isEnumDeclaration(node) && node.name) {
      const enumName = node.name.text;
      const members = node.members.map((member) => member.name.getText());
      enums.push({ name: enumName, members });
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      // console.log("isFunctionDeclaration")
      // const functionName = node.name.text;
      // const parameters = node.parameters.map((param) => {
      //   const paramType = extractType(param.type);
      //   if (ts.isObjectBindingPattern(param.name)) {
      //     const elements = param.name.elements.map((element) => {
      //       const name = element.name.getText();
      //       console.info("paramType", paramType)
      //       const type = paramType === name ? paramType : 'any';
      //       return { name, type };
      //     });
      //     return elements;
      //   } else {
      //     const paramName = param.name.getText();
      //     return { name: paramName, type: paramType };
      //   }
      // }).flat();
      // const returnType = node.type ? extractType(node.type) : 'void';
      // const genericTypes = extractGenericTypes(node);
      const { name, parameters, returnType, genericTypes } = getFunctionFromNode(node);
      functions.push({ name, parameters, returnType, genericTypes });
    }
    if (ts.isVariableStatement(node) || ts.isFunctionDeclaration(node)) {
      const componentName = node.name?.text;
      if (componentName && isReactComponent(node)) {
        const props = extractReactProps(node);
        const genericTypes = extractGenericTypes(node);
        components.push({ name: componentName, props, genericTypes });
      }
    }
    if (ts.isImportDeclaration(node)) {
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
    }
    // Extract export information
    if (ts.isExportDeclaration(node)) {
      console.log("ts.isExportDeclaration")
      if (node.exportClause && node.exportClause.elements) {
        node.exportClause.elements.forEach((element) => {
          exports.push({ name: element.name.getText(), type: "variable" });
        });
      } else if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const exportedModule = node.moduleSpecifier.text;
        exports.push({ name: `* as ${exportedModule}`, type: "module" });
      }
    } else if (ts.isExportAssignment(node)) {
      console.log("ts.isExportAssignment")
      if (ts.isIdentifier(node.expression)) {
        exports.push({ name: "default", type: "variable" });
      } else if (ts.isFunctionDeclaration(node.expression)) {
        exports.push({ name: "default", type: "function" });
      } else if (ts.isClassDeclaration(node.expression)) {
        exports.push({ name: "default", type: "class" });
      } else if (ts.isCallExpression(node.expression)) {
        exports.push({ name: "default", type: "function" });
      }
    } else if (ts.isVariableStatement(node) && node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword)) {
      node.declarationList.declarations.forEach((declaration) => {
        if (ts.isVariableDeclaration(declaration)) {
          console.log("isVariableDeclaration")
          const variableName = declaration.name.getText();
          const { type, value } = extractValue(declaration.initializer, declaration.name.getText());
          console.log("adding:::", { name: variableName, type, value })
          exports.push({ name: variableName, type, value });
        }
      });
    }

    // Extract default exported declarations
    if (node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword) &&
      node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword)) {
      if (ts.isFunctionDeclaration(node)) {
        const functionName = node.name ? node.name.getText() : 'anonymous';
        exports.push({ name: "default", type: "function" });

        // Extract function information
        const parameters = node.parameters.map((param) => {
          const paramType = extractType(param.type);
          if (ts.isObjectBindingPattern(param.name)) {
            const elements = param.name.elements.map((element) => {
              const name = element.name.getText();
              const type = paramType.find((prop) => prop.name === name)?.type || 'any';
              return { name, type };
            });
            return elements;
          } else {
            const paramName = param.name.getText();
            return { name: paramName, type: paramType };
          }
        }).flat();
        const returnType = node.type ? extractType(node.type) : 'void';
        const genericTypes = extractGenericTypes(node);
        const isAsync = node.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword);
        functions.push({ name: functionName, parameters, returnType, genericTypes, isAsync });
      } else if (ts.isVariableDeclaration(node)) {
        console.log("isVariableDeclaration")
        exports.push({ name: "default", type: "variable" });
      }
    }

    // Extract named export information
    ts.forEachChild(node, (child) => {
      if (ts.isVariableStatement(child)) {
        child.declarationList.declarations.forEach((declaration) => {
          if (declaration.initializer && isExportedDeclaration(declaration)) {
            console.log("isExportedDeclaration")
            const exportName = declaration.name.getText();
            const exportValue = extractValue(declaration.initializer);
            exports.push({ name: exportName, type: "variable", value: exportValue });
          }
        });
      } else if (ts.isFunctionDeclaration(child) && child.name && isExportedDeclaration(child)) {
        const exportName = child.name.text;
        const isAsync = child.modifiers?.some(mod => mod.kind === ts.SyntaxKind.AsyncKeyword);
        exports.push({ name: exportName, type: isAsync ? "asyncFunction" : "function" });

        // Extract function information
        const functionName = child.name.text;
        const parameters = child.parameters.map((param) => {
          const paramType = extractType(param.type);
          if (ts.isObjectBindingPattern(param.name)) {
            const elements = param.name.elements.map((element) => {
              const name = element.name.getText();
              const type = paramType.find((prop) => prop.name === name)?.type || 'any';
              return { name, type };
            });
            return elements;
          } else {
            const paramName = param.name.getText();
            return { name: paramName, type: paramType };
          }
        }).flat();
        console.log("ts.isFunctionDeclaration parameters", parameters)
        const returnType = child.type ? extractType(child.type) : 'void';
        const genericTypes = extractGenericTypes(child);
        functions.push({ name: functionName, parameters, returnType, genericTypes, isAsync });
      } else if (ts.isClassDeclaration(child) && child.name && isExportedDeclaration(child)) {
        const exportName = child.name.text;
        exports.push({ name: exportName, type: "class" });
      } else if (ts.isInterfaceDeclaration(child) && child.name && isExportedDeclaration(child)) {
        const exportName = child.name.text;
        exports.push({ name: exportName, type: "interface" });
      } else if (ts.isTypeAliasDeclaration(child) && child.name && isExportedDeclaration(child)) {
        const exportName = child.name.text;
        exports.push({ name: exportName, type: "typeAlias" });
      } else if (ts.isEnumDeclaration(child) && child.name && isExportedDeclaration(child)) {
        const exportName = child.name.text;
        exports.push({ name: exportName, type: "enum" });
      }
    });
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

function extractValue(node, label) {
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
        const paramType = extractType(param.type);
        console.log("Returning prop type", paramType, param.name.text)
        props.push({ name: param.name.text, type: paramType });
      }
    });
  } else if (ts.isVariableStatement(node)) {
    node.declarationList.declarations.forEach((declaration) => {
      if (isFunctionExpression(declaration) && declaration.initializer.parameters) {
        declaration.initializer.parameters.forEach((param) => {
          if (ts.isParameter(param) && param.type) {
            const paramType = extractType(param.type);
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
function extractType(node) {
  if (!node) {
    return 'any';
  }

  if (ts.isTypeLiteralNode(node)) {
    console.log("isTypeLiteral")
    const properties = node.members
      .filter(ts.isPropertySignature)
      .map((member) => ({
        name: member.name.getText(),
        type: extractType(member.type),
      }));
    console.log("returning", properties, node?.name, node?.typeName)
    return properties;
  } else if (ts.isTypeReferenceNode(node)) {
    const typeName = node.typeName.getText();
    const typeArguments = node.typeArguments
      ? node.typeArguments.map(extractType)
      : [];
    console.log("isTypeReferenceNode", typeName, `<${typeArguments.map(JSON.stringify).join(', ')}>`)
    return `${typeName}${typeArguments.length > 0 ? `<${typeArguments.map(JSON.stringify).join(', ')}>` : ''}`;
  } else if (ts.isArrayTypeNode(node)) {
    const elementType = extractType(node.elementType);
    console.log("isArrayTypeNode", elementType)
    return `${elementType}[]`;
  } else {
    console.log("else getText", node?.name, node.getText())
    return node.getText();
  }
}

// Helper function to infer the return type of a function
function inferReturnType(node) {
  const returnStatement = findReturnStatement(node);
  if (returnStatement) {
    const returnExpression = returnStatement.expression;
    if (returnExpression) {
      return extractType(returnExpression);
    }
  }
  return 'void';
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

if (mermaid?.initialize) {
  // Initialize Mermaid
  mermaid.initialize({
    startOnLoad: true,
  });
}

// chunkTypeScriptFiles(directoryPath, maxContextSize);
// processDirectory(directoryPath, maxContextSize, 'crawled.jsonl');

(async () => {
  try {
    const filePath = '/home/acidhax/dev/originals/dataset-manager-nextjs/src/app/hooks/useProjectConfig.ts';
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