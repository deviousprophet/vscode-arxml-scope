/////////////////////////////////////////////////////////////////////////////////////
//
//  Arxml2Artext: Converts an AUTOSAR ECUC Values file to its Artext counterpart
//
//  Arguments (to be specified with -A key value at the end of the command line;
//             all these arguments are optional):
//
//  Key     | Value         | Description
//  =================================================================================
//  sort    | all           | The output is sorted (1) by DefinitionRef and
//          |               | (2) by shortName/content
//  ---------------------------------------------------------------------------------
//  except  | <comma-sepa-  | Short names of configuration elements which shall not
//          |  rated list   | be sorted (only evaluated if "sort all" has also been
//          |  of sorting   | specified); only the short names of the corresponding
//          |  exceptions>  | ParamDef entries shall be given here, not the entire
//          |               | DefinitionRef
//          |               | Please take care that, in case of multiple exceptions,
//          |               | no spaces are allowed in the exception list, e.g.
//          |               | "except A,B" is legal but "except A, B" leads to a
//          |               | runtime error!
//  =================================================================================
//
// Example invocation:
//   mmx -M Arxml2Artext.mm -S in.arxml -T out.artext -A sort all except Anna,Berta
//
/////////////////////////////////////////////////////////////////////////////////////


!DECLARATION
    !declare *argSort := argument[?sort].data;
    !declare *argExcept := argument[?except].data.split(",");

/////////////////////////////////////////////////////////////////////////////////////

!SOURCEFORMAT (wfxml)
    // Non-validating parsing
    !detect  1;
    !begin [] <|library|>node{"MMxml"},
        <|procedure|>node{"xml2mmb"},
        argument
        ;


/////////////////////////////////////////////////////////////////////////////////////

!TARGETFORMAT (artext)
    !detect 1;
    !begin []
        <|production|>node{"artext"},
        argument
        ;

!PRODUCTION [production?artext]
    !define \indent() "\n", "    ".duplicate(count(self.ancestor));
    !define \structify() join((this.split("/")):2~-1, ".");
    !define \lastShortName() this.split("/"):-1;
    !define \camelize() ( *words := this.split("-"), *wordsCamel := *words.(split(""):1.uppercase(), split(""):2~-1.lowercase()) ).null, join(*wordsCamel);
    !define \appendSyscond() !if (child[?SW-SYSCOND]) !then " [", child[?SW-SYSCOND].data.MMstring\trim, "]" !end;
    !define \appendPBVarCond() !if (child[?POST-BUILD-VARIANT-CONDITION]) !then " <", join(child[?POST-BUILD-VARIANT-CONDITION].join((child[?MATCHING-CRITERION-REF].data.\lastShortName, " == ", child[?VALUE].data.MMstring\trim), ""), " && "), ">" !end;
    !define \formatAnnotation() !if (child[?LABEL]) !then " [", child[?LABEL].child[?L-4].data.MMstring\trim, "] " !end, child[?ANNOTATION-TEXT].child[?VERBATIM].child[?L-5].data.MMstring\trim;
    !define \appendAnnotations() !if (child[?ANNOTATIONS]) !then " /*", child[?ANNOTATIONS].child[?ANNOTATION].\formatAnnotation, " */" !end;
    !define \appendGstStuff() \appendSyscond(), \appendPBVarCond(), \appendAnnotations();

    !begin [] argument[?file].openproduct(data);
    !up [] argument[?file].closeproduct;

    SCHEMA []
        "schema ", data.split(" "):-1.split("."):1.split("_"):-1.join((this.split("-")), "."), "\n"
        // E.g.: "http://autosar.org/schema/r4.0 AUTOSAR_4-0-2.xsd" -> "AUTOSAR_4-0-2.xsd" -> "AUTOSAR_4-0-2" -> "4-0-2" -> "4.0.2"
    ;

    AR-PACKAGE []
        "package ", data.\structify, "\n"
    ;

    ECUC-MODULE-CONFIGURATION-VALUES []
        \indent, "module ", child[?DEFINITION-REF].data.\structify, " \"", child[?SHORT-NAME].data, "\"",
        !if (child[?IMPLEMENTATION-CONFIG-VARIANT]) !then
            " (", child[?IMPLEMENTATION-CONFIG-VARIANT].data.\camelize, ")"
        !end,
        \appendGstStuff(),
        \indent, "{"
    ;
    !up []
        \indent, "}\n"
    ;

    ECUC-CONTAINER-VALUE []
        \indent, child[?DEFINITION-REF].data.\lastShortName, " \"", child[?SHORT-NAME].data, "\"",
        \appendGstStuff(),
        \indent, "{"
    ;
    !up []
        \indent, "}"
    ;

    ECUC-NUMERICAL-PARAM-VALUE []
        \indent, child[?DEFINITION-REF].data.\lastShortName, " = ", child[?VALUE].data,
		!if ((child[?VALUE].data ~=== "true") & (child[?VALUE].data ~=== "false")) !then
			" (= 0x" , child[?VALUE].data.MMSystem\dec2hex, ")"
		!end,
		\appendGstStuff()
    ;

    ECUC-TEXTUAL-PARAM-VALUE []
        \indent, child[?DEFINITION-REF].data.\lastShortName, " = \"", child[?VALUE].data, "\"", \appendGstStuff()
    ;

    ECUC-REFERENCE-VALUE []
        \indent, child[?DEFINITION-REF].data.\lastShortName, " = ", child[?VALUE-REF].data.\structify, \appendGstStuff()
    ;

    ECUC-INSTANCE-REFERENCE-VALUE []
        \indent, child[?DEFINITION-REF].data.\lastShortName, " = ",
        child[?VALUE-IREF].child[?TARGET-REF].data.\structify,
        !if (child[?VALUE-IREF].child[?CONTEXT-ELEMENT-REF]) !then
            " context ",
            join(child[?VALUE-IREF].child[?CONTEXT-ELEMENT-REF].data.\structify, ", ")
        !end,
        \appendGstStuff()
    ;

    !string [] !replace null;
    !pi [] !replace null;


/////////////////////////////////////////////////////////////////////////////////////

!TRANSFORMATION
    !define \lastShortName() this.split("/"):-1;
    !define \sortKey() join(
        // Is the short name of the corresponding ParamDef entry contained in the exception list?
        !if (child[?DEFINITION-REF].data.\lastShortName() === *argExcept) !then
            // Yes -> only sort by DefinitionRef but not by short name resp. content
            (child[?DEFINITION-REF].data)
        !else
            // No -> sort by a concatenation of DefinitionRef and short name resp. content
            (child[?DEFINITION-REF].data, "\"", child[?SHORT-NAME | ?VALUE | ?VALUE-REF | ?VALUE-IREF].data, "\"")
        !end
    );

AUTOSAR [] !replace
    <|SCHEMA|>node {self.r.atvalue("xsi:schemaLocation")},
    self.r.descendant[?ELEMENTS]:1, // Only take first AR-PACKAGE hierarchy to drop the EcucValueCollections package
    !if (*argSort === "all") !then
        sort(self.r.descendant[?ECUC-MODULE-CONFIGURATION-VALUES], \sortKey())
    !else
        self.r.descendant[?ECUC-MODULE-CONFIGURATION-VALUES]
    !end
;

ELEMENTS [] !replace
    <|AR-PACKAGE|>node
    {
        join(("", self.r.reverse(ancestor[?AR-PACKAGE]).child[?SHORT-NAME].data), "/")
    }
;

ECUC-MODULE-CONFIGURATION-VALUES []
    self.r.child[?ANNOTATIONS],
    self.r.child[?VARIATION-POINT],
    self.r.child[?DEFINITION-REF],
    self.r.child[?SHORT-NAME],
    self.r.child[?IMPLEMENTATION-CONFIG-VARIANT],
    !if (*argSort === "all") !then
        sort(self.r.child[?CONTAINERS].child[?ECUC-CONTAINER-VALUE], \sortKey())
    !else
        self.r.child[?CONTAINERS].child[?ECUC-CONTAINER-VALUE]
    !end
;

ECUC-CONTAINER-VALUE []
    self.r.child[?ANNOTATIONS],
    self.r.child[?VARIATION-POINT],
    self.r.child[?DEFINITION-REF],
    self.r.child[?SHORT-NAME],
    !if (*argSort === "all") !then
        sort(self.r.child[?PARAMETER-VALUES].child[?ECUC-NUMERICAL-PARAM-VALUE | ?ECUC-TEXTUAL-PARAM-VALUE], \sortKey()),
        sort(self.r.child[?REFERENCE-VALUES].child[?ECUC-REFERENCE-VALUE | ?ECUC-INSTANCE-REFERENCE-VALUE], \sortKey()),
        sort(self.r.child[?SUB-CONTAINERS].child[?ECUC-CONTAINER-VALUE], \sortKey())
    !else
        self.r.child[?PARAMETER-VALUES].child[?ECUC-NUMERICAL-PARAM-VALUE | ?ECUC-TEXTUAL-PARAM-VALUE],
        self.r.child[?REFERENCE-VALUES].child[?ECUC-REFERENCE-VALUE | ?ECUC-INSTANCE-REFERENCE-VALUE],
        self.r.child[?SUB-CONTAINERS].child[?ECUC-CONTAINER-VALUE]
    !end
;

VARIATION-POINT [] !replace
    self.r.child[?SW-SYSCOND],
    self.r.child[?POST-BUILD-VARIANT-CONDITIONS].child[?POST-BUILD-VARIANT-CONDITION]
;

SYSC-REF []
    self.r.data.\lastShortName
;