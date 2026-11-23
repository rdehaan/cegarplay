// ACE mode for the CegarPlay loop language.
ace.define("ace/mode/loop_highlight_rules", ["require", "exports", "module", "ace/lib/oop", "ace/mode/text_highlight_rules"], function (require, exports) {
  "use strict";
  var oop = require("../lib/oop");
  var TextHighlightRules = require("./text_highlight_rules").TextHighlightRules;
  var LoopHighlightRules = function () {
    var keywordMapper = this.createKeywordMapper({
      "keyword": "solver|link|via|options|legacy|compat|lift|keep|def|return|if|elif|else|loop|while|repeat|until|for|in|search|on|candidate|" +
        "partial|every|reject|with|accept|restart|stop|break|continue|count|by|track|log|assume|limit|optimal|and|or|not",
      "constant.language": "true|false|none",
      "support.function": "solve|models|add|expand|exhausted|step|clause|block|core|clauses|atoms|push|clear|size"
    }, "identifier");
    this.$rules = {
      start: [
        { token: "comment", regex: "#.*$" },
        { token: "string", regex: '"(?:\\\\.|[^"\\\\])*"' },
        { token: "constant.numeric", regex: "\\d+(?:\\.\\d+)?\\b" },
        { token: keywordMapper, regex: "[a-zA-Z_][a-zA-Z0-9_]*\\b" },
        { token: "keyword.operator", regex: "->|==|!=|<=|>=|[=<>+\\-*/]" },
        { token: "paren.lparen", regex: "[\\[(]" },
        { token: "paren.rparen", regex: "[\\])]" },
        { token: "text", regex: "\\s+" }
      ]
    };
    this.normalizeRules();
  };
  oop.inherits(LoopHighlightRules, TextHighlightRules);
  exports.LoopHighlightRules = LoopHighlightRules;
});

ace.define("ace/mode/loop", ["require", "exports", "module", "ace/lib/oop", "ace/mode/text", "ace/mode/loop_highlight_rules"], function (require, exports) {
  "use strict";
  var oop = require("../lib/oop");
  var TextMode = require("./text").Mode;
  var LoopHighlightRules = require("./loop_highlight_rules").LoopHighlightRules;
  var Mode = function () { this.HighlightRules = LoopHighlightRules; this.$behaviour = this.$defaultBehaviour; };
  oop.inherits(Mode, TextMode);
  (function () {
    this.lineCommentStart = "#";
    this.getNextLineIndent = function (state, line, tab) {
      var indent = this.$getIndent(line);
      if (/:\s*(#.*)?$/.test(line)) indent += tab;
      return indent;
    };
    this.$id = "ace/mode/loop";
  }).call(Mode.prototype);
  exports.Mode = Mode;
});
