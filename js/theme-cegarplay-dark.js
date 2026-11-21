// ACE theme for the dark colour theme (css/theme.css), in the form of ACE's bundled textmate
// theme. It covers the tokens of js/mode-gringo.js (with its Lua rules) and js/mode-loop.js.
// js/editors.js switches every editor between this theme and textmate.
ace.define('ace/theme/cegarplay_dark', ['require', 'exports', 'module', 'ace/lib/dom'], function (require, exports) {
  'use strict';
  exports.isDark = true;
  exports.cssClass = 'ace-cegarplay-dark';
  exports.cssText = [
    '.ace-cegarplay-dark {background-color: #26282c; color: #d6d6d6;}',
    '.ace-cegarplay-dark .ace_gutter {background: #2e3034; color: #8f949a;}',
    '.ace-cegarplay-dark .ace_gutter-active-line {background-color: #383b40;}',
    '.ace-cegarplay-dark .ace_print-margin {width: 1px; background: #383b40;}',
    '.ace-cegarplay-dark .ace_cursor {color: #f0f0f0;}',
    '.ace-cegarplay-dark .ace_invisible {color: #5a5e64;}',
    '.ace-cegarplay-dark .ace_fold {background-color: #8bbce6; border-color: #d6d6d6;}',
    '.ace-cegarplay-dark .ace_marker-layer .ace_selection {background: #3f5873;}',
    '.ace-cegarplay-dark.ace_multiselect .ace_selection.ace_start {box-shadow: 0 0 3px 0 #26282c;}',
    '.ace-cegarplay-dark .ace_marker-layer .ace_step {background: #5c4a17;}',
    '.ace-cegarplay-dark .ace_marker-layer .ace_stack {background: #2f4a25;}',
    '.ace-cegarplay-dark .ace_marker-layer .ace_bracket {margin: -1px 0 0 -1px; border: 1px solid #6e7277;}',
    '.ace-cegarplay-dark .ace_marker-layer .ace_active-line {background: rgba(255, 255, 255, 0.06);}',
    '.ace-cegarplay-dark .ace_marker-layer .ace_selected-word {background: #34373c; border: 1px solid #5a6a80;}',
    '.ace-cegarplay-dark .ace_storage, .ace-cegarplay-dark .ace_keyword {color: #82aaff;}',
    '.ace-cegarplay-dark .ace_keyword.ace_operator {color: #a9b1bb;}',
    '.ace-cegarplay-dark .ace_keyword.ace_control {color: #c792ea;}',
    '.ace-cegarplay-dark .ace_constant {color: #f78c6c;}',
    '.ace-cegarplay-dark .ace_constant.ace_numeric {color: #f5b36b;}',
    '.ace-cegarplay-dark .ace_constant.ace_language {color: #c3a6ff;}',
    '.ace-cegarplay-dark .ace_constant.ace_library {color: #7fd394;}',
    '.ace-cegarplay-dark .ace_support.ace_function {color: #89ddff;}',
    '.ace-cegarplay-dark .ace_support.ace_constant {color: #7fd394;}',
    '.ace-cegarplay-dark .ace_variable {color: #6fc3d6;}',
    '.ace-cegarplay-dark .ace_variable.ace_language {color: #ff9cac;}',
    '.ace-cegarplay-dark .ace_string {color: #a5d68a;}',
    '.ace-cegarplay-dark .ace_comment {color: #8aa596; font-style: italic;}',
    '.ace-cegarplay-dark .ace_invalid {background-color: rgba(242, 139, 127, 0.15); color: #f28b7f;}',
    '.ace-cegarplay-dark .ace_invalid.ace_deprecated {background-color: transparent; color: #e6b765;}',
    '.ace-cegarplay-dark .ace_entity.ace_name.ace_function {color: #82aaff;}',
    '.ace-cegarplay-dark .ace_indent-guide {box-shadow: inset -1px 0 0 #383b40;}',
  ].join('\n');
  require('../lib/dom').importCssString(exports.cssText, exports.cssClass);
});
