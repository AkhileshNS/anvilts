# README

This documentation concerns the `ltsp.jar` file which is generated based on a proprietory `cli` branch of the LTSA Source code. In this branch, we have removed all files and folders in the project other than the `/lts` folder which contains the LTS Compiler. The primary intention behind this branch is to create a CLI (using [picocli](https://picocli.info/)) that allows users to work with the LTS Compiler. 

To use the CLI, reference the `ltsp.jar` and run commands on the jar from a terminal. As a start, here is the usage of the cli (provided by picocli):

```
Usage: [-l=<property>] [-p=<process>] (-b=<buildCommand> |
            -c=<checkCommand>) <path>
A CLI which wraps around the LTS Compiler to provide it's functionality in
concise manner.
      <path>                The full path of the lts file on which various
                              functionality is to be performed
  -b, --build=<buildCommand>
                            parse, compile or compose <COMPOSITE_PROCESS>
  -c, --check=<checkCommand>
                            safety, progress or ltl_property <ASSERTION>
  -l, --property=<property> The ltl property to perform an assertion on
  -p, --process=<process>   The composite process on which to perform
                              composition
```

In essence, the CLI provides six main functions:-

1. **Parse**: Takes a `.lts` file and parses it to validate the syntax

   ```bash
   java -jar ./ltsp.jar <PATH_TO_LTS_FILE> -b parse
   ```

   The LTSA equivalent of this is "Build > Parse"

2. **Compile**: Takes a `.lts` file and compiles it's output (It also parses the file) 

   ```bash
   java -jar ./ltsp.jar <PATH_TO_LTS_FILE> -b compile -p <COMPOSITE_PROCESS_NAME>
   ```

   Note. If you don't have a composite process in your lts file, you can just pass "DEFAULT" 

   The LTSA equivalent of this is "Build > Compile"

3. **Compose**: Takes a `.lts` file, parallelizes the specified composite process and returns it's output (It also parses and compiles the file) 

   ```bash
   java -jar ./ltsp.jar <PATH_TO_LTS_FILE> -b compose -p <COMPOSITE_PROCESS_NAME>
   ```

   The LTSA equivalent of this is "Build > Compose"

4. **Safety**: Takes a `.lts` file and checks if its processes and specified composite process are deadlock free (It also parses, compiles and composes the file)

   ```bash
   java -jar ./ltsp.jar <PATH_TO_LTS_FILE> -c safety -p <COMPOSITE_PROCESS_NAME>
   ```

   The LTSA equivalent of this is "Check > Safety"

5. **Progress**: Takes a `.lts` file and checks for progress violations in its processes and specified composite process (It also parses, compiles and composes the file)

   ```bash
   java -jar ./ltsp.jar <PATH_TO_LTS_FILE> -c progress -p <COMPOSITE_PROCESS_NAME>
   ```

   The LTSA equivalent of this is "Check > Progress"

6. **LTL Property**: Takes a `.lts` file and checks if the specified LTL (Linear Temporal Logic) Assertion holds for the specified composite process (It also parses, compiles and composes the file)

   ```bash
   java -jar ./ltsp.jar <PATH_TO_LTS_FILE> -c safety -p <COMPOSITE_PROCESS_NAME> -l <ASSERTION_NAME>
   ```

   The LTSA equivalent of this is "Check > LTL Property > 'ASSERTION_NAME'"

### Working

Internally the CLI works by creating an instance of the LTS Compiler class and triggering specific functions in the class to perform the above behaviors:

```java
// Example Psuedocode
LTSCompiler compiler = new LTSCompiler(...);

// Parse
compiler.parse(...);

// Compile
compiler.compile(...);

// Compose
(compiler.compile(...)).compose(...);

// Safety
(compiler.compile(...)).analyse(...);

// Progress
(compiler.compile(...)).checkProgress(...);

// LTL Property
CompositeState cs = compiler.compile(...);
CompositeState ltl_property = AssertDefinition.compile(...);
cs.checkLTL(...);
```