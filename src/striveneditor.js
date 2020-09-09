import './striveneditor.css';
import {
  EXTENSIONS,
  FONTPACK,
  OPTIONGROUPS,
  DEFAULTOPTIONS,
  ACTIVEOPTIONCOLOR,
  FORECOLORICON,
  HILITECOLORICON,
  FONTNAMES,
  FONTSIZES,
  COLLAPSEICON,
  EXPANDICON,
  DESIGNICON,
} from './defaults.js';

// Helpers
import { 
  createSVG,
  denormalizeCamel,
  blowUpElement 
} from './utils';

// Polyfills
import ResizeObserver from 'resize-observer-polyfill';

// Plugins
import linkify from 'linkifyjs/element';

// Pickr
import './classic.min.css';
import Pickr from './pickr.min.js';

/* Represents an instance of the Striven Editor */
export default class StrivenEditor {
  /**
   * Bind onchange handler to contenteditable element
   * @param {HTMLElement} element to bind onchange to
   */
  _bindContenteditableOnChange(el) {
    const se = this;

    el.addEventListener('focus', function() {
      if (el.data_orig === undefined) {
        el.data_orig = el.innerHTML;
      }
    });

    el.addEventListener('blur', function() {
      setTimeout(() => {
        const menus = se.editor.getElementsByClassName('se-popup-open');
        const inputs = se.editor.getElementsByTagName('input');

        const actives = [...menus, ...inputs, se.body, se.toolbar, se.editor];

        if (
          se.editor.getAttribute('data-expanded') !== 'true' && 
          el.innerHTML != el.data_orig &&
          !se.toolbarClick &&
          !actives.includes(document.activeElement) &&
          !menus.length
        ) {
          se.options.change(se.getContent());
          delete el.data_orig;
        }
      }, 500);
    });

    se.toolbarClick = false;
    se.toolbar.addEventListener('mousedown', () => {
      se.toolbarClick = true;
    });

    se.toolbar.addEventListener('mouseup', () => {
      se.toolbarClick = false;
    });
  }

  /**
   * Instantiate the StrivenEditor
   * @param {HTMLElement} el The element to initialize StrivenEditor on
   * @param {Object} options StrivenEditor options to initialize the editor with
   */
  constructor(el, options) {
    const se = this; 

    // Webpack inserts the package.json version
    se['_version'] = __VERSION__;

    // Establish the browser context
    se.establishBrowser();

    // Initialize a range instance for the editor
    se.range = new Range();

    // Initialize a file array for file upload
    se.files = [];

    // Default Option Groups with SVG Data
    se.optionGroups = OPTIONGROUPS;

    // Initialize Options
    if (options) {
      // Set options property
      se.options = options;

      // Font Pack for font-awesome (not being used)
      options.fontPack || (se.options.fontPack = FONTPACK);

      // Allowed File Extensions
      options.extensions || (se.options.extensions = EXTENSIONS);

      // Enabled Toolbar options
      options.toolbarOptions || (se.options.toolbarOptions = DEFAULTOPTIONS);

      // Fill color for active options
      options.activeOptionColor ||
        (se.options.activeOptionColor = ACTIVEOPTIONCOLOR);

      // Default fonts names
      options.fontNames || (se.options.fontNames = FONTNAMES);

      // Allow File Upload
      options.fileUpload !== false && (se.options.fileUpload = true);

      // Configure Options with Minimal Enabled
      if (options.toolbarOptions && options.minimal) {
        // Get custom options from toolbarOptions
        const customs = options.toolbarOptions.filter(
          opt => typeof opt === 'object',
        );

        // Set toolbar options for minimal configuration
        se.options.toolbarOptions = [
          'bold',
          'italic',
          'underline',
          'insertUnorderedList',
          'attachment',
          'link',
          ...customs,
        ];

        se.options.canTab = false;
      }
    } else {
      // Set default options
      se.options = {
        fontPack: FONTPACK,
        extensions: EXTENSIONS,
        toolbarOptions: DEFAULTOPTIONS,
        activeOptionColor: ACTIVEOPTIONCOLOR,
        fontNames: FONTNAMES,
        fileUpload: true,
        canTab: false
      };
    }

    // Initialize the editor
    se.initEditor(el); // Core Editor Initialization
    se.initResponsive(); // Editor Reponsive Logic
    se.initOverflow(); // Overflow Content Logic
    se.overflow(); // Trigger overflow login on init

    // DOM Access to the Editor Instance
    el.StrivenEditor = () => se;

    // Bind handler functions to scope
    se.bound_popupEscapeHandler = se.popupEscapeHandler.bind(se);
  }

  /**
   * Initiliaze the StrivenEditor on the passed element.
   * @param {HTMLElement} el
   */
  initEditor(el) {
    const se = this; 

    se.editor = el;
    se.toolbar = se.initToolbar();
    se.body = se.initBody();
    se.linkMenu = se.initLinkMenu();
    se.imageMenu = se.initImageMenu();
    se.tableMenu = se.initTableMenu();
    se.metaDataSection = se.options.metaUrl
      ? se.initMetaDataSection()
      : null;
    se.filesSection = se.options.fileUpload
      ? se.initFilesSection()
      : null;

    // Add Striven Editor Class
    se.editor.classList.add('striven-editor');

    // Stop events from bubbling up the DOM
    se.editor.onkeypress = e => e.stopPropagation();

    // Initialze with the value property in the options
    se.setContent(se.options.value || '');

    window.addEventListener('click', () => {
      if (!se.editor.contains(document.activeElement)) {
        se.closeAllMenus();
      }
    });

    // Toolbar Hide
    if (se.options.toolbarHide) {
      // Hide the toolbar template if there is one
      se.toolbarTemplate && (se.toolbarTemplate.style.display = 'none');

      // Hide the toolbar options
      se.toolbarOptionsGroup.style.display = 'none';

      // Add the close class
      se.toolbar.classList.add('se-toolbar-close');

      // Bind the focus event to reopen the toolbar
      const bodyFocus = se.body.onfocus;
      se.body.onfocus = () => {
        se.overflow();
        se.openToolbar();

        bodyFocus && bodyFocus();
      };

      // Bind the blur event close the toolbar
      const bodyBlur = se.body.onblur;
      se.body.onblur = () => {
        bodyBlur && bodyBlur();
        se.overflow();

        // Do not close the toolbar is editor is active
        setTimeout(() => {
          if (
            se.linkMenu.dataset.active !== 'true' &&
            se.imageMenu.dataset.active !== 'true' &&
            se.tableMenu.dataset.active !== 'true' &&
            !se.isEditorInFocus()
          ) {
            se.closeToolbar();
          }
        }, 200);
      };
    } else {
      se.toolbar.style.boxShadow = '#ddd -1px 2px 3px 0px';
      se.toolbar.style.height = 'fit-content';
    }

    // Toolbar Options
    se.toolbarOptions.forEach(optionEl => {
      // Execute Toolbar Commands
      const optionElClick = optionEl.onclick;

      // Bind the toolbar commands click hander
      optionEl.onclick = e => {
        if (!se.browser.isSafari()) {
          se.range = se.getRange();
        }

        // Get the document execute command
        const command = optionEl.id.split('-').pop();

        // Command Logic
        switch (command) {
          case 'bold':
          case 'underline':
          case 'italic':
          case 'strikethrough':
            // If active, deactive the command
            if (optionEl.classList.contains('se-toolbar-option-active')) {
              optionEl.classList.remove('se-toolbar-option-active');

              // Save the range
              se.setRange();

              // Focus back into the body
              se.body.focus();

              // If the command is active, deactivate the command
              document.queryCommandState(command) &&
                se.executeCommand(command);
            } else {
              // Set the command active (body on focus will execute the command)
              optionEl.classList.add('se-toolbar-option-active');

              // Save the range
              se.setRange();

              // Focus back into the body
              se.body.focus();
            }
            break;
          case 'removeFormat':
           
            const clear = () => {
              const range = se.getRange();

              const textNode = document.createTextNode( range.toString() );
              range.deleteContents();
              range.insertNode(textNode);
              range.selectNodeContents(textNode);

              // Deactivate all toolbar options
              se.toolbarOptions.forEach(o =>
                o.classList.remove('se-toolbar-option-active'),
              );
            }
            
            try {
              
              const range = se.getRange(); 
              
              const { commonAncestorContainer } = range; 
              const { tagName } = commonAncestorContainer;
              
              if(commonAncestorContainer) {
                
                if(tagName && (tagName === 'OL' || tagName === 'UL')) {
                  commonAncestorContainer.innerHTML = commonAncestorContainer.textContent;
                  return;
                }

                const { parentElement } = commonAncestorContainer;
                const formatTags = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
                if(formatTags.includes(parentElement.tagName)) {
                  parentElement.outerHTML = parentElement.textContent;
                  return;
                }

              }

              const { previousElementSibling } = textNode;
              if(previousElementSibling.tagName === 'OL' || previousElementSibling.tagName === 'UL') {
                !previousElementSibling.textContent && previousElementSibling.remove();
              }

              clear();

            } catch (e) {
              clear();
            }

            break;
          case 'indent':
            setTimeout(() => se.setRange(se.range), 0);
          default:
            se.body.focus();
            se.executeCommand(command);
            break;
        }

        optionElClick && optionElClick();
      };
    });

    // Add dividers
    function constructDivider() {
      const divider = document.createElement('div');
      divider.classList.add('se-divider-section');

      const bar = document.createElement('div');
      bar.classList.add('se-divider-bar');

      divider.append(bar);
      return divider;
    }

    const areas = [
      ...se.toolbarGroups,
      ...se.toolbar.querySelectorAll('.se-toolbar-selection'),
    ];
    areas.forEach(a => {
      if (a.querySelector('.se-toolbar-option')) {
        a.after(constructDivider());
      }
    });

    // Construct editor elements
    se.toolbar && se.editor.appendChild(se.toolbar);
    se.body && se.editor.appendChild(se.body);
    se.linkMenu && se.editor.appendChild(se.linkMenu);
    se.imageMenu && se.editor.appendChild(se.imageMenu);
    se.tableMenu && se.editor.appendChild(se.tableMenu);
    se.metaDataSection && se.editor.appendChild(se.metaDataSection);
    se.filesSection && se.editor.appendChild(se.filesSection);

    // Reposition Toolbar
    if (se.options.toolbarBottom) {
      se.toolbar.classList.add('se-toolbar-bottom');
      se.toolbar.classList.add('se-toolbar-top');

      se.linkMenu.classList.remove('se-popup-top');
      se.linkMenu.classList.add('se-popup-bottom');

      se.imageMenu.classList.remove('se-popup-top');
      se.imageMenu.classList.add('se-popup-bottom');

      se.tableMenu.classList.remove('se-popup-top');
      se.tableMenu.classList.add('se-popup-bottom');

      se.editor.removeChild(se.toolbar);
      se.editor.append(se.toolbar);
    }
  }

  /**
   * Open the toolbar for when the toolbarHide option is set to true
   */
  openToolbar() {
    const se = this; 

    se.toolbar.classList.remove('se-toolbar-close');
    setTimeout(() => {
      se.toolbarOptionsGroup.style.display = 'flex';
      se.toolbarTemplate && (se.toolbarTemplate.style.display = 'flex');
    }, 200);
  }
  /**
   * Close the toolbar for when the toolbarHide option is set to true
   */
  closeToolbar() {
    const se = this; 

    se.closeAllMenus();
    se.toolbarOptionsGroup.style.display = 'none';
    se.toolbarTemplate && (se.toolbarTemplate.style.display = 'none');
    se.toolbar.classList.add('se-toolbar-close');
  }

  /**
   * Initialized the toolbar for StrivenEditor
   * @returns {HTMLElement} The StrivenEditor toolbar
   */
  initToolbar() {
    const se = this; 

    const toolbar = document.createElement('div');
    se.toolbarOptionsGroup = document.createElement('div');
    const groups = Object.keys(se.optionGroups);

    toolbar.classList.add('se-toolbar');
    toolbar.classList.add('toolbar-top');

    se.toolbarOptionsGroup.classList.add('se-toolbar-options');

    toolbar.onclick = () => {
      se.body.focus();
    };

    // Append Font Options
    !se.options.minimal && se.initToolbarFontOptions();

    //iterate groups
    groups.forEach(group => {
      // add menu to toolbarOptions
      const toolbarMenu = document.createElement('div');
      // const toolbarMenuIcon = document.createElement("i");

      toolbarMenu.classList.add('se-toolbar-menu');
      toolbarMenu.id = `menu-${group}`;

      // toolbarMenuIcon.classList.add(se.options.fontPack);
      // toolbarMenuIcon.classList.add(se.optionGroups[group].menu);

      const arrow = {
        viewBox: '0 0 1792 1792',
        d:
          'M1395 736q0 13-10 23l-466 466q-10 10-23 10t-23-10l-466-466q-10-10-10-23t10-23l50-50q10-10 23-10t23 10l393 393 393-393q10-10 23-10t23 10l50 50q10 10 10 23z',
      };

      const svgSpan = se.constructSVG(se.optionGroups[group].menu);
      toolbarMenu.appendChild(svgSpan.getElementsByTagName('svg')[0]);

      if (group !== 'options') {
        const arrowSpan = se.constructSVG(arrow);
        arrowSpan.classList.add('se-arrow-span');
        toolbarMenu.appendChild(arrowSpan);
      }

      se.toolbarOptionsGroup.appendChild(toolbarMenu);

      // add group to toolbarOptions
      const toolbarGroup = document.createElement('div');

      toolbarGroup.classList.add('se-toolbar-group');
      toolbarGroup.id = `group-${group}`;

      // iterate options within group
      se.options.toolbarOptions.forEach(option => {
        const toolbarOption = se.optionGroups[group].group.filter(
          group => group[option],
        )[0];
        if (toolbarOption) {
          const svgData = toolbarOption[option];
          const optionSpan = se.constructSVG(svgData);

          optionSpan.classList.add('se-toolbar-option');
          optionSpan.id = `toolbar-${option}`;
          optionSpan.title = denormalizeCamel(option);

          switch (option) {
            case 'removeFormat':
              optionSpan.setAttribute('title', 'Clear Format');
              break;
            case 'hiliteColor':
              optionSpan.setAttribute('title', 'Background Color');
              break;
            default:
              optionSpan.setAttribute('title', denormalizeCamel(option));
              break;
          }
          toolbarGroup.appendChild(optionSpan);
        }
      });

      se.toolbarOptionsGroup.appendChild(toolbarGroup);
    });

    toolbar.appendChild(se.toolbarOptionsGroup);

    // Custom toolbar template
    if (se.options.toolbarTemplate) {
      const toolbarTemplate = document.createElement('div');
      toolbarTemplate.id = 'toolbar-template';
      toolbarTemplate.setAttribute('style', 'display: flex');

      toolbarTemplate.appendChild(se.options.toolbarTemplate);
      toolbar.appendChild(toolbarTemplate);

      se.toolbarTemplate = toolbarTemplate;
    }

    se.toolbarOptions = toolbar.querySelectorAll('span');
    se.toolbarGroups = [
      ...toolbar.getElementsByClassName('se-toolbar-group'),
    ];
    se.toolbarMenus = [...toolbar.getElementsByClassName('se-toolbar-menu')];

    // Remove menu that has no options enabled
    se.toolbarGroups.forEach(group => {
      if (group && group.children.length < 1) {
        const groupName = group.id.split('-')[1];
        const menu = se.toolbarMenus.filter(
          menu => menu && menu.id.split('-')[1] === groupName,
        )[0];
        menu.remove();
      }
    });

    const miscOptions = toolbar.querySelector('#group-options');
    // toolbar group for custom options
    const customOptions = se.options.toolbarOptions.filter(
      option => typeof option === 'object',
    );
    if (customOptions.length > 0) {
      customOptions.forEach(opt => {
        const {icon, handler, title} = opt;

        if (typeof icon === 'object') {
          const option = se.constructSVG({viewBox: icon.viewBox, d: icon.d});
          option.classList.add('se-toolbar-option');

          option.onclick = () => handler(option);
          option.setAttribute('id', `toolbar-${title}`);
          option.setAttribute('title', denormalizeCamel(title));

          miscOptions.appendChild(option);
        } else {
          const option = document.createElement('span');
          const image = document.createElement('img');
          image.setAttribute('src', opt.icon);
          image.setAttribute('alt', 'custom option');

          option.style.paddingTop = '6px';
          option.style.paddingBottom = '8px';
          option.classList.add('se-toolbar-option');

          option.onclick = () => handler();

          option.append(image);
          miscOptions.appendChild(option);
        }
      });
    }

    const removeFormatOption = toolbar.querySelector('#toolbar-removeFormat');

    if (removeFormatOption) {
      removeFormatOption.remove();
      miscOptions.append(removeFormatOption);
    }

    return toolbar;
  }

  /*
   * Initializes the toolbars font options
   */
  initToolbarFontOptions() {
    const se = this;

    function initMenu(name, onOpen) {
      const menu = document.createElement('div');
      menu.setAttribute('id', `${name}-menu`);
      menu.classList.add(
        'se-popup',
        se.options.toolbarBottom ? 'se-popup-bottom' : 'se-popup-top',
      );
      menu.dataset.active = 'false';

      menu.open = () => {
        se.closeAllMenus();

        se.setMenuOffset(se.toolbar.querySelector(`#toolbar-${name}`), menu);

        menu.classList.add('se-popup-open');

        menu.dataset.active = 'true';
        se.addPopupEscapeHandler();

        onOpen && onOpen(menu);
      };

      menu.close = () => {
        menu.classList.remove('se-popup-open');
        menu.dataset.active = 'false';
        se.removePopupEscapeHandler();
      };

      se.editor.append(menu);
      return menu;
    }

    function initFontNameMenu(select) {
      const menu = initMenu('fontName');

      menu.dataset.init = 'true';
      ['(inherited font)', ...se.options.fontNames].forEach(f => {
        const fontOption = document.createElement('div');

        fontOption.classList.add('se-toolbar-popup-option');
        fontOption.textContent = f;
        fontOption.style.fontFamily = f;

        fontOption.onclick = e => {
          let fontselect = e.target.textContent;
          select.textContent = fontselect;
          menu.close();

          const refocus = se.body.onfocus;
          se.body.onfocus = () => {
            function execute() {
              if (fontselect === '(inherited font)') {
                fontselect = getComputedStyle(se.body).fontFamily;
              }

              if (se.browser.isEdge() || se.browser.isFirefox()) {
                document.execCommand('fontName', false, fontselect);
              } else {
                document.execCommand('fontName', true, fontselect);
              }
            }

            se.setRange(se.range);

            if (!se.getContent()) {
              const enabler = () => {
                setTimeout(() => {
                  execute();
                  se.body.removeEventListener('keydown', enabler);
                });
              };

              se.body.addEventListener('keydown', enabler);
            }

            setTimeout(() => execute(), 0);

            if (se.scrollPosition && !se.browser.isEdge()) {
              se.body.scrollTo(se.scrollPosition.x, se.scrollPosition.y);
            }
            se.body.onfocus = refocus;
          };

          se.body.focus();
        };

        menu.append(fontOption);
      });

      return menu;
    }

    function initFontSizeMenu(select) {
      const menu = initMenu('fontSize');

      const sizes = FONTSIZES;

      ['(inherited size)', ...Object.keys(sizes)].forEach(size => {
        let s = sizes[size] || '(inherited size)';

        const fontOption = document.createElement('div');

        fontOption.classList.add('se-toolbar-popup-option');
        fontOption.textContent = s;

        fontOption.onclick = e => {
          function execute() {
            let execSize = size;

            if (size === '(inherited size)') {
              execSize = 3;
            }

            if (se.browser.isEdge() || se.browser.isFirefox()) {
              document.execCommand('fontSize', false, execSize);
            } else {
              document.execCommand('fontSize', true, execSize);
            }
          }

          const fontsize = e.target.textContent;

          select.textContent = fontsize;
          select.dataset.command = size;

          menu.close();

          const refocus = se.body.focus;
          se.body.onfocus = () => {
            se.setRange(se.range);

            if (!se.getContent()) {
              const enabler = () => {
                setTimeout(() => {
                  execute();
                  se.body.removeEventListener('keydown', enabler);
                }, 0);
              };

              se.body.addEventListener('keydown', enabler);
            }

            setTimeout(() => execute(), 0);

            if (se.scrollPosition && !se.browser.isEdge()) {
              se.body.scrollTo(se.scrollPosition.x, se.scrollPosition.y);
            }
            se.body.onfocus = refocus;
          };

          se.body.focus();
        };

        menu.append(fontOption);
      });

      return menu;
    }

    function initFontFormatMenu() {
      const se = this; 

      const menu = initMenu('fontFormat');

      const formats = [
        {
          command: 'H1',
          option: '<h1 style="margin: 0; color: #000;">Heading 1</h1>',
        },
        {
          command: 'H2',
          option: '<h2 style="margin: 0; color: #000;">Heading 2</h2>',
        },
        {
          command: 'H3',
          option: '<h3 style="margin: 0; color: #000;">Heading 3</h4>',
        },
        {
          command: 'H4',
          option: '<h4 style="margin: 0; color: #000;">Heading 4</h4>',
        },
        {
          command: 'H5',
          option: '<h5 style="margin: 0; color: #000;">Heading 5</h5>',
        },
        {
          command: 'H6',
          option: '<h6 style="margin: 0; color: #000;">Heading 6</h6>',
        },
        {
          command: 'P',
          option: '<p style="margin: 0; color: #000;">Paragraph</p>',
        },
      ];

      formats.forEach(s => {
        const fontOption = document.createElement('div');

        fontOption.classList.add('se-toolbar-popup-option');
        fontOption.innerHTML = s.option;

        fontOption.onclick = e => {
          menu.close();
          se.body.focus();
          se.setRange();

          if (se.browser.isFirefox() || se.browser.isEdge()) {
            document.execCommand('removeFormat', false);
          } else {
            document.execCommand('removeFormat', true);
          }

          se.executeCommand('formatBlock', s.command);
        };

        menu.append(fontOption);
      });

      return menu;
    }

    // Get enabled toolbar options
    const enabledOptions = se.options.toolbarOptions;

    // Enable font name option
    if (enabledOptions.includes('fontName')) {
      // Initialize and append toolbar option
      const fontSelect = document.createElement('div');
      const selectedFont = document.createElement('p');

      // Initialize the popup menu to be length of longest name
      const menu = initFontNameMenu(selectedFont);

      // Toggle the fontselect popup on the select click
      fontSelect.onclick = () => {
        if (!se.browser.isSafari()) {
          se.range = se.getRange();
        }

        if (menu.dataset.active === 'true') {
          menu.close();
        } else {
          menu.open();
        }
      };

      // Set the select to initialize on the first font name
      selectedFont.textContent = '(inherited font)';

      fontSelect.setAttribute('id', 'toolbar-fontName');

      fontSelect.classList.add('se-toolbar-selection');
      selectedFont.classList.add('se-toolbar-option');

      fontSelect.append(selectedFont);
      se.toolbarOptionsGroup.append(fontSelect);
      se.fontName = selectedFont;
    }

    // Enable font size option
    if (enabledOptions.includes('fontSize')) {
      const fontSizeSelect = document.createElement('div');
      const selectedFontSize = document.createElement('p');
      const menu = initFontSizeMenu(selectedFontSize);

      fontSizeSelect.onclick = () => {
        if (!se.browser.isSafari()) {
          se.range = se.getRange();
        }

        if (menu.dataset.active === 'true') {
          menu.close();
        } else {
          menu.open();
        }
      };

      fontSizeSelect.setAttribute('id', 'toolbar-fontSize');
      selectedFontSize.textContent = '(inherited size)';

      fontSizeSelect.classList.add('se-toolbar-selection');
      selectedFontSize.classList.add('se-toolbar-option');

      fontSizeSelect.append(selectedFontSize);
      se.toolbarOptionsGroup.append(fontSizeSelect);
      se.fontSize = selectedFontSize;
    }

    if (enabledOptions.includes('fontFormat')) {
      const fontFormatSelect = document.createElement('div');
      const selectedFontFormat = document.createElement('p');
      const menu = initFontFormatMenu();

      fontFormatSelect.onclick = () => {
        if (!se.browser.isSafari()) {
          se.range = se.getRange();
        }

        if (menu.dataset.active === 'true') {
          menu.close();
        } else {
          menu.open();
        }
      };

      fontFormatSelect.setAttribute('id', 'toolbar-fontFormat');
      selectedFontFormat.textContent = 'Format';

      fontFormatSelect.classList.add('se-toolbar-selection');
      selectedFontFormat.classList.add('se-toolbar-option');

      fontFormatSelect.append(selectedFontFormat);
      se.toolbarOptionsGroup.append(fontFormatSelect);
    }
  }

  /**
   * Initialized the StrivenEditor body
   * @returns {HTMLElement} The StrivenEditor body
   */
  initBody() {
    const se = this;
    const body = document.createElement('div');

    body.classList.add('se-body');
    body.contentEditable = 'true';
    body.style.height = se.editor.style.height;
    body.style.minHeight = se.editor.style.minHeight;
    body.style.maxHeight = se.editor.style.maxHeight;
    
    se.editor.setAttribute('height', se.editor.style.height);
    se.editor.setAttribute('min-height', se.editor.style.minHeight);
    se.editor.setAttribute('max-height', se.editor.style.maxHeight);
    
    se.editor.style.height = 'auto';
    se.editor.style.minHeight = 'auto';
    se.editor.style.maxHeight = 'auto';

    se.options.placeholder &&
      (body.dataset.placeholder = se.options.placeholder);

    if (se.options.change) {
      se._bindContenteditableOnChange(body);
    }

    // Execute this function on mouseup and keyup
    const execRange = () => {
      const current = se.getRange();
      if (current) {
        se.range = current;
      }
    };

    // Paste Handler
    body.onpaste = e => {
       
      // Editor Paste Handler
      if(se.options.onPaste) {
        const content = se.options.onPaste(e);
        if(content) {
          e.preventDefault(); 
          se.executeCommand('insertHTML', content);
          return true;
        }
      }

      // Convert envoding to file
      function dataURLtoFile(dataurl, filename) {
        var arr = dataurl.split(','),
          mime = arr[0].match(/:(.*?);/)[1],
          bstr = atob(arr[1]),
          n = bstr.length,
          u8arr = new Uint8Array(n);
        while (n--) {
          u8arr[n] = bstr.charCodeAt(n);
        }

        const file = new File([u8arr], filename, {type: mime});
        return new File([u8arr], `${file.name}.${file.type.split('/').pop()}`, {
          type: file.type,
        });
      }

      // Converty file to encoding
      const convertImage = file =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result);
          reader.onerror = error => reject(error);
        });

      // Paste image logic for Edge
      if (
        se.browser.isEdge() &&
        e.clipboardData.items &&
        e.clipboardData.items.length > 0 &&
        e.clipboardData.items[0].type.includes('image')
      ) {
        convertImage(e.clipboardData.items[0].getAsFile()).then(res => {
          document.execCommand('insertImage', false, res);
        });
      }

      // Paste image logic
      if (
        e.clipboardData.files &&
        e.clipboardData.files.length > 0 &&
        e.clipboardData.files[0].type.includes('image')
      ) {
        e.preventDefault();

        convertImage(e.clipboardData.files[0]).then(res => {
          if (se.options.imageUrl) {
            se.getImage(res)
              .then(data => {
                document.execCommand('insertImage', true, data.imageRef);
              })
              .catch(err => {
                document.execCommand('insertImage', true, res);
              });
          } else {
            if (se.browser.isFirefox() || se.browser.isEdge()) {
              document.execCommand('insertImage', false, res);
            } else {
              document.execCommand('insertImage', true, res);
            }
            se.options.uploadOnPaste &&
              se.attachFile(dataURLtoFile(res, 'pastedimage'));
          }
          se.overflow();
        });
      }

      // sanitize of html
      if (
        se.options.sanitizePaste &&
        e.clipboardData.types.includes('text/html')
      ) {
        e.preventDefault();

        let pastedHtmlItem;

        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];
          item.type === 'text/html' && (pastedHtmlItem = item);
        }

        if (pastedHtmlItem) {
          pastedHtmlItem.getAsString(htmlString => {
            const range = se.getRange();
            range.insertNode(se.scrubHTML(htmlString));
            range.collapse();
          });
        }
      }

      let pastedText = false;
      // pasting text content
      if (
        e.clipboardData.items &&
        e.clipboardData.items.length > 0 &&
        e.clipboardData.items[0].type === 'text/plain'
      ) {
        let string = e.clipboardData.getData('text/plain');
        string && (pastedText = string);

        if (se.validURL(string.trim())) {
          string = string.trim();

          // get meta data
          if (se.options.metaUrl) {
            se.getMeta(string).then(res => {
              const {url, title, image, description} = res;
              url &&
                title &&
                image &&
                se.createMetaDataElement(url, image, title, description);
            });
          }
        }
      }

      

      // After the paste
      setTimeout(() => {
        // Prune inline styles
        se.pruneInlineStyles(se.body);

        // Convert all the links
        se.convertAndSelectLinks();

        // Editor After Paste Handler
        se.options.afterPaste && se.options.afterPaste(e);
      }, 10);

      se.overflow();
    };

    body.onkeydown = e => {
      switch (e.key) {
        case 'Tab':
          if (se.options.canTab) {
            e.shiftKey
              ? se.executeCommand('outdent')
              : se.executeCommand('indent');
            e.preventDefault();
          }
          break;
        case 'Shift':
          break;
        case 'Backspace':
          se.textBuffer &&
            (se.textBuffer = se.textBuffer.substring(
              0,
              se.textBuffer.length - 1,
            ));
          break;
        case 'Control':
          break;
        case 'Alt':
          break;
        case 'Enter':
        case ' ':
          se.validURL(se.textBuffer) && se.convertAndSelectLinks();
          se.textBuffer = null;
          break;
        case 'Semicolon':
          if (e.shiftKey) {
            se.textBuffer ? (se.textBuffer += ':') : (se.textBuffer = ':');
          }
          break;
        default:
          se.textBuffer ? (se.textBuffer += e.key) : (se.textBuffer = e.key);
          break;
      }
    };

    // State of the editor
    const bodyKeyup = body.onkeyup;
    body.onkeyup = e => {
      bodyKeyup && bodyKeyup();
      execRange();

      if (e.key) {
        switch (e.key) {
          case 'Enter':
            se.options.onEnter && se.options.onEnter(e);
            break;
          default:
            break;
        }
      }

      se.setFontStates();
      se.toolbarState();
    };

    const bodyFocus = body.onfocus;
    body.onfocus = e => {
      !se.browser.isEdge() && se.setRange();

      window.addEventListener('mouseup', execRange);

      se.editor.classList.add('se-focus');

      if (se.scrollPosition && !se.browser.isEdge()) {
        body.scrollTo(se.scrollPosition);
      }

      bodyFocus && bodyFocus();
    };

    // Bind state management event
    body.addEventListener('focus', () => {
      // disables all states
      se.options.toolbarOptions.forEach(opt => {
        if (typeof opt === 'string') {
          if (
            document.queryCommandState('insertUnorderedList') &&
            opt === 'insertUnorderedList'
          ) {
            return false;
          }
          if (
            document.queryCommandState('insertOrderedList') &&
            opt === 'insertOrderedList'
          ) {
            return false;
          }

          document.queryCommandState(opt) && se.executeCommand(opt);
        }
      });

      // enable only active states
      se.getActiveOptions().forEach(opt => {
        !document.queryCommandState(opt) && se.executeCommand(opt);
      });
    });

    const bodyBlur = body.onblur;
    body.onblur = e => {
      se.editor.classList.remove('se-focus');

      window.removeEventListener('mouseup', execRange);

      se.scrollPosition = {
        y: body.scrollTop,
        x: body.scrollWidth,
      };

      se.textBuffer = null;
      se.convertAndSelectLinks(false);

      bodyBlur && bodyBlur();
    };

    const bodyClick = body.onclick;
    body.onclick = () => {
      se.closeAllMenus();
      se.setFontStates();
      body.textContent && se.toolbarState();
      bodyClick && bodyClick;
    };

    const bodyKeyPress = body.onkeypress;
    body.onkeypress = () => {
      bodyKeyPress && bodyKeyPress();
    };

    return body;
  }

  /**
   * Intializes the StrivenEditor link menu popup
   * @returns {HTMLElement} The StrivenEditor link menu
   */
  initLinkMenu() {
    const se = this;

    const linkMenu = document.createElement('div');
    const linkMenuHeader = document.createElement('p');
    const linkMenuForm = document.createElement('div');
    const linkMenuButtons = document.createElement('div');
    const linkMenuButton = document.createElement('button');
    const linkMenuCloseButton = document.createElement('button');
    const linkMenuFormLabel = document.createElement('p');
    const linkMenuFormInput = document.createElement('input');
    const linkMenuCheck = document.createElement('input');

    function resetInput() {
      linkMenuFormInput.value = 'http://';
    }

    linkMenu.id = 'link-menu';
    linkMenu.classList.add('se-popup', 'se-popup-top');
    linkMenu.dataset.active = 'false';

    linkMenuForm.classList.add('se-popup-form');

    linkMenuFormLabel.classList.add('se-form-label');
    linkMenuFormLabel.textContent = 'URL';

    linkMenuFormInput.classList.add('se-form-input');
    se.options.useBootstrap && linkMenuFormInput.classList.add('form-control');
    linkMenuFormInput.type = 'text';
    linkMenuFormInput.placeholder = 'Insert a Link';

    resetInput();

    linkMenuButton.type = 'button';
    linkMenuCloseButton.type = 'button';

    linkMenuButtons.classList.add('se-popup-button-container');

    linkMenuButton.classList.add('se-popup-button', 'se-button-primary');
    linkMenuButton.textContent = 'Insert';

    linkMenuCloseButton.classList.add('se-popup-button', 'se-button-secondary');
    linkMenuCloseButton.textContent = 'Close';

    linkMenuButton.onclick = e => {
      const linkValue = linkMenuFormInput.value;
      se.body.focus();
      se.setRange();

      if (linkValue) {
        if (se.browser.isFirefox() || se.browser.isEdge()) {
          document.execCommand('createLink', false, linkValue);
        } else {
          document.execCommand('createLink', true, linkValue);
        }

        const insertedLink = se.getRange().commonAncestorContainer
          .parentElement;
        if (insertedLink) {
          windowRowInput.checked &&
            insertedLink.setAttribute('target', '_blank');
          windowRowInput.checked = true;

          if (textRowInput.value) {
            insertedLink.textContent = textRowInput.value;
            textRowInput.value = '';
          }

          insertedLink.parsed = true;
        }

        if (se.options.metaUrl && se.validURL(linkValue)) {
          se.getMeta(linkValue).then(res => {
            const {url, image, title, description} = res;
            url &&
              image &&
              title &&
              se.createMetaDataElement(url, image, title, description);
          });
        }

        // insert link on no selection
        if (se.browser.isFirefox() || se.browser.isEdge()) {
          if (se.range.startOffset === se.range.endOffset) {
            const link = document.createElement('a');
            link.href = linkValue;
            link.textContent = linkValue;

            se.range.insertNode(link);
            se.range.selectNode(link);
            se.range.collapse();
          }
        }

        // Remove contenteditable for firefox
        if (!se.browser.isFirefox()) {
          const bodyLinks = se.body.querySelectorAll('a');
          [...bodyLinks].forEach(link => (link.contentEditable = 'false'));
        }

        // trigger input event
        if (se.body.oninput) {
          se.body.oninput();
        }

        se.closeLinkMenu();
      } else {
        se.body.focus();
        se.closeLinkMenu();
      }

      resetInput();
    };

    linkMenuCloseButton.onclick = e => {
      se.body.focus();
      se.closeLinkMenu();
      resetInput();
    };

    linkMenuHeader.classList.add('se-popup-header');
    linkMenuHeader.innerText = 'Insert Link';

    linkMenu.appendChild(linkMenuHeader);

    linkMenuForm.appendChild(linkMenuFormLabel);
    linkMenuForm.appendChild(linkMenuFormInput);

    const textRow = linkMenuForm.cloneNode(true);
    const textRowLabel = textRow.querySelector('.se-form-label');
    const textRowInput = textRow.querySelector('.se-form-input');

    if (textRowLabel) {
      textRowLabel.innerText = 'Text';
    }

    if (textRowInput) {
      textRowInput.value = '';
      textRowInput.placeholder = 'Text content';
    }

    const windowRow = linkMenuForm.cloneNode(true);
    const windowRowLabel = windowRow.querySelector('.se-form-label');
    const windowRowInput = windowRow.querySelector('.se-form-input');

    if (windowRow) {
      windowRow.setAttribute(
        'style',
        'justify-content: flex-end; align-items: center;',
      );
    }

    if (windowRowLabel) {
      windowRowLabel.innerText = 'Open in new window?';
    }

    if (windowRowInput) {
      windowRowInput.checked = true;
      windowRowInput.setAttribute('type', 'checkbox');
      windowRowInput.setAttribute('style', 'width: auto');
    }

    linkMenu.appendChild(linkMenuForm);
    linkMenu.appendChild(textRow);
    linkMenu.appendChild(windowRow);

    linkMenuButtons.appendChild(linkMenuButton);
    linkMenuButtons.appendChild(linkMenuCloseButton);

    linkMenu.appendChild(linkMenuButtons);

    [...linkMenu.getElementsByTagName('input')].forEach(inp => {
      inp.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      };
    });
    return linkMenu;
  }

  /**
   * Initializes the StrivenEditor image menu popup
   * @returns {HTMLElement} The StrivenEditor image menu
   */
  initImageMenu() {
    const se = this;

    const imageMenu = document.createElement('div');
    const imageMenuHeader = document.createElement('p');
    const imageMenuForm = document.createElement('div');
    const imageMenuButtons = document.createElement('div');
    const imageMenuButton = document.createElement('button');
    const imageMenuCloseButton = document.createElement('button');
    const imageMenuFormLabel = document.createElement('p');
    const imageMenuFormSourceInput = document.createElement('input');

    imageMenu.id = 'image-menu';
    imageMenu.classList.add('se-popup', 'se-popup-top');
    imageMenu.dataset.active = 'false';

    imageMenuForm.classList.add('se-popup-form');

    imageMenuFormLabel.classList.add('se-form-label');
    imageMenuFormLabel.textContent = 'Image URL';

    imageMenuFormSourceInput.classList.add('se-form-input');
    se.options.useBootstrap &&
      imageMenuFormSourceInput.classList.add('form-control');

    imageMenuFormSourceInput.type = 'text';
    imageMenuFormSourceInput.placeholder = 'Insert a Link';

    imageMenuButtons.classList.add('se-popup-button-container');

    imageMenuButton.type = 'button';
    imageMenuCloseButton.type = 'button';

    imageMenuButton.classList.add('se-popup-button', 'se-button-primary');
    imageMenuButton.textContent = 'Insert Image';

    imageMenuCloseButton.classList.add(
      'se-popup-button',
      'se-button-secondary',
    );
    imageMenuCloseButton.textContent = 'Close';

    imageMenuForm.appendChild(imageMenuFormLabel);
    imageMenuForm.appendChild(imageMenuFormSourceInput);

    // Height Input Form
    const imageMenuHeightForm = imageMenuForm.cloneNode(true);
    const imageMenuHeightFormInput = imageMenuHeightForm.querySelector('input');
    const imageMenuHeightFormLabel = imageMenuHeightForm.querySelector('p');

    imageMenuHeightFormInput.placeholder = 'Image Height';
    imageMenuHeightFormLabel.textContent = 'Height';

    // Width Input Form
    const imageMenuWidthForm = imageMenuForm.cloneNode(true);
    const imageMenuWidthFormInput = imageMenuWidthForm.querySelector('input');
    const imageMenuWidthFormLabel = imageMenuWidthForm.querySelector('p');

    imageMenuWidthFormInput.placeholder = 'Image Width';
    imageMenuWidthFormLabel.textContent = 'Width';

    imageMenuButton.onclick = e => {
      se.body.focus();
      se.setRange();

      const linkValue = imageMenuFormSourceInput.value;
      const heightValue = imageMenuHeightFormInput.value;
      const widthValue = imageMenuWidthFormInput.value;

      if (linkValue) {
        if (se.browser.isFirefox() || se.browser.isEdge()) {
          document.execCommand('insertImage', false, linkValue);
        } else {
          document.execCommand('insertImage', true, linkValue);
        }

        let insertedImage = [...se.body.querySelectorAll(`img`)].filter(
          img => img.src === linkValue,
        );
        insertedImage = insertedImage[insertedImage.length - 1];
        insertedImage &&
          insertedImage.setAttribute('height', `${heightValue}px`);
        insertedImage && insertedImage.setAttribute('width', `${widthValue}px`);

        imageMenuHeightFormInput.value = '';
        imageMenuWidthFormInput.value = '';
        imageMenuFormSourceInput.value = '';
        se.closeImageMenu();
      } else {
        se.body.focus();
        se.closeImageMenu();
      }
    };
    imageMenuCloseButton.onclick = e => {
      se.body.focus();
      se.closeImageMenu();
    };

    imageMenuHeader.classList.add('se-popup-header');
    imageMenuHeader.innerText = 'Insert Image';

    imageMenu.appendChild(imageMenuHeader);

    imageMenu.appendChild(imageMenuHeightForm);
    imageMenu.appendChild(imageMenuWidthForm);
    imageMenu.appendChild(imageMenuForm);

    imageMenuButtons.appendChild(imageMenuButton);
    imageMenuButtons.appendChild(imageMenuCloseButton);

    imageMenu.appendChild(imageMenuButtons);

    [...imageMenu.getElementsByTagName('input')].forEach(inp => {
      inp.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      };
    });
    return imageMenu;
  }

  initTableMenu() {
    const se = this;

    const tableMenu = document.createElement('div');
    const tableMenuHeader = document.createElement('p');
    const tableMenuForm = document.createElement('div');
    const tableMenuButtons = document.createElement('div');
    const tableMenuButton = document.createElement('button');
    const tableMenuCloseButton = document.createElement('button');
    const tableMenuFormLabel = document.createElement('p');
    const tableMenuFormColsInput = document.createElement('input');

    tableMenu.id = 'table-menu';
    tableMenu.classList.add('se-popup', 'se-popup-top');
    tableMenu.dataset.active = 'false';

    tableMenuForm.classList.add('se-popup-form');

    tableMenuFormLabel.classList.add('se-form-label');
    tableMenuFormLabel.textContent = 'Columns';

    tableMenuFormColsInput.classList.add('se-form-input');
    se.options.useBootstrap &&
      tableMenuFormColsInput.classList.add('form-control');

    tableMenuFormColsInput.type = 'text';
    tableMenuFormColsInput.placeholder = 'Table Columns';

    tableMenuButtons.classList.add('se-popup-button-container');

    tableMenuButton.type = 'button';
    tableMenuCloseButton.type = 'button';

    tableMenuButton.classList.add('se-popup-button', 'se-button-primary');
    tableMenuCloseButton.classList.add(
      'se-popup-button',
      'se-button-secondary',
    );

    tableMenuButton.textContent = 'Create Table';
    tableMenuCloseButton.textContent = 'Close';

    tableMenuForm.appendChild(tableMenuFormLabel);
    tableMenuForm.appendChild(tableMenuFormColsInput);

    // Rows Input
    const tableMenuRowsForm = tableMenuForm.cloneNode(true);
    const tableMenuRowsInput = tableMenuRowsForm.querySelector('input');
    const tableMenuRowsLabel = tableMenuRowsForm.querySelector('p');

    tableMenuRowsInput.placeholder = 'Table Rows';
    tableMenuRowsLabel.textContent = 'Rows';

    tableMenuRowsInput.value = '3';
    tableMenuFormColsInput.value = '3';

    function clearValues() {
      tableMenuFormColsInput.value = '3';
      tableMenuRowsInput.value = '3';
    }

    tableMenuButton.onclick = () => {
      se.body.focus();
      se.setRange();

      if (tableMenuFormColsInput.value && tableMenuRowsInput.value) {
        se.generateTable(
          parseInt(tableMenuFormColsInput.value),
          parseInt(tableMenuRowsInput.value),
        );
      }

      clearValues();
      se.closeAllMenus();
      se.body.focus();
    };

    tableMenuCloseButton.onclick = () => {
      clearValues();
      se.closeAllMenus();
    };

    tableMenuHeader.classList.add('se-popup-header');
    tableMenuHeader.innerText = 'Insert Table';

    tableMenu.appendChild(tableMenuHeader);

    tableMenuButtons.appendChild(tableMenuButton);
    tableMenuButtons.appendChild(tableMenuCloseButton);
    tableMenu.appendChild(tableMenuRowsForm);
    tableMenu.appendChild(tableMenuForm);
    tableMenu.appendChild(tableMenuButtons);

    [...tableMenu.getElementsByTagName('input')].forEach(inp => {
      inp.onkeydown = e => {
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      };
    });
    return tableMenu;
  }

  /**
   * Initializes the StrivenEditor meta data section for inserted links into the editor
   * @returns {HTMLElement} The StrivenEditor meta data section
   */
  initMetaDataSection() {
    const metaDataSection = document.createElement('div');
    metaDataSection.classList.add('se-metadata-section');

    return metaDataSection;
  }

  /**
   * Initializes the StrivenEditor meta data section for attached files
   * @returns {HTMLElement} The StrivenEditor attached file section
   */
  initFilesSection() {
    const se = this; 

    const filesSection = document.createElement('div');
    filesSection.classList.add('se-files-section');

    window.addEventListener(
      'dragover',
      function(e) {
        e = e || event;
        e.preventDefault();
      },
      false,
    );

    window.addEventListener(
      'drop',
      function(e) {
        e = e || event;
        e.preventDefault();
      },
      false,
    );

    se.body.ondragenter = e => {
      if (
        !se.body.querySelector('.se-file-drop-dropzone') &&
        e.dataTransfer.types.includes('Files')
      ) {
        const dropzone = document.createElement('div');
        const dropzoneTextEl = document.createElement('p');

        dropzone.classList.add('se-file-drop-dropzone');
        dropzone.contentEditable = 'false';
        dropzoneTextEl.textContent = 'Drop files to upload';

        dropzone.ondrop = e => e.target.remove();
        dropzone.ondragover = e => (dropzone.dataset.enabled = 'true');

        dropzone.append(dropzoneTextEl);
        se.body.append(dropzone);
      }
    };

    se.body.ondragleave = e => {
      const dropzone = se.body.querySelector('.se-file-drop-dropzone');
      dropzone && dropzone.dataset.enabled === 'true' && dropzone.remove();
    };

    se.body.ondrop = e => {
      const dropzone = se.body.querySelector('.se-file-drop-dropzone');
      dropzone && dropzone.remove();

      e.preventDefault();

      if (e.dataTransfer.types.includes('Files')) {
        if (e.dataTransfer.files.length) {
          [...e.dataTransfer.files].forEach(file => se.attachFile(file));
        }
      }
    };

    se.isEdge && (se.body.ondragover = e => e.preventDefault());

    return filesSection;
  }

  /**
   * Creates a file element and appends it to the attached files seciton of the editor
   * @param {String} name Name of the file
   * @param {Number} size Size of the file in bytes
   */
  createFileElement(name, size) {
    const fileEl = document.createElement('div');
    const fileNameEl = document.createElement('p');
    const fileSizeEl = document.createElement('p');
    const removeFileEl = document.createElement('p');

    fileNameEl.textContent = name;
    fileSizeEl.textContent = size;
    removeFileEl.textContent = 'X';

    fileEl.classList.add('se-file');
    fileEl.dataset.fileindex = se.files.length - 1;

    fileNameEl.classList.add('se-file-name');

    fileSizeEl.classList.add('se-file-size');

    removeFileEl.classList.add('se-remove-link');

    removeFileEl.onclick = e => {
      se.files.splice(e.target.parentElement.dataset.fileindex, 1);
      e.target.parentElement.remove();
    };

    fileEl.appendChild(fileNameEl);
    fileEl.appendChild(fileSizeEl);
    fileEl.appendChild(removeFileEl);

    se.filesSection.appendChild(fileEl);
  }

  /**
   * Creates a meta data element and appends it to the meta data section of the editor
   * @param {String} url Url of the inserted link
   * @param {String} img Image to use for the meta data item
   * @param {String} title Title of the meta data item
   * @param {String} description Description of the meta data item
   */
  createMetaDataElement(url, img, title, description) {
    const metaItemEl = document.createElement('div');
    const metaLinkEl = document.createElement('a');
    const metaImageEl = document.createElement('img');
    const metaDataEl = document.createElement('div');
    const metaDataTitleEl = document.createElement('h4');
    const metaDataDescriptionEl = document.createElement('p');
    const removeMetaDataEl = document.createElement('span');

    metaLinkEl.href = url;
    metaImageEl.src = img;
    metaDataTitleEl.textContent = title;
    metaDataDescriptionEl.textContent = description;
    removeMetaDataEl.textContent = 'X';

    metaLinkEl.target = 'blank';

    metaItemEl.classList.add('se-meta-item');

    metaImageEl.classList.add('se-meta-image');

    metaDataTitleEl.classList.add('se-meta-data-title');

    metaDataDescriptionEl.style.margin = '0';

    removeMetaDataEl.classList.add('se-remove-link');

    removeMetaDataEl.onclick = e => e.target.parentElement.remove();

    metaLinkEl.appendChild(metaImageEl);

    metaDataEl.appendChild(metaDataTitleEl);
    metaDataEl.appendChild(metaDataDescriptionEl);

    metaItemEl.appendChild(metaLinkEl);
    metaItemEl.appendChild(metaDataEl);
    metaItemEl.appendChild(removeMetaDataEl);

    se.metaDataSection.appendChild(metaItemEl);
  }

  /**
   * Constructs an svg given an object with the viewBox and d property
   * @param {Object} svgData ViewBox and D attributes to use for the <svg>
   * @returns {HTMLElement} Returns the constructed svg
   */
  constructSVG(svgData) {
    const se = this; 

    const {viewBox, d} = svgData;
    const fillColor = se.options.toolbarOptionFillColor
      ? se.options.toolbarOptionFillColor
      : '#333';
    const xmlns = 'http://www.w3.org/2000/svg';
    const height = '14';
    const width = '16';

    const icon = document.createElement('span');
    const svg = `<svg width="${width}" height="${height}" viewBox="${viewBox}" xmlns="${xmlns}">`;
    const path = `<path fill="${fillColor}" d="${d}"/>`;

    icon.innerHTML = `${svg}${path}</svg>`;

    return icon;
  }

  /**
   * Initialize the responsive properties of the editor
   */
  initResponsive() {
    const se = this;

    if (!se.options.minimal) {
      function responsiveGroups(isResponsive) {
        se.toolbarGroups.forEach(group => {
          if (group) {
            group.dataset.open = 'false';

            group.style.display = isResponsive ? 'none' : 'block';
            group.style.position = isResponsive ? 'absolute' : 'relative';

            if (!isResponsive) {
              group.setAttribute('style', null);
              group.classList.remove('se-popup');
              group.classList.remove(
                se.options.toolbarBottom ? 'se-popup-bottom' : 'se-popup-top',
              );
            }
          }
        });

        se.toolbarMenus.forEach(menu => {
          function toggleMenu() {
            const selectedGroup = se.toolbar.querySelector(
              `#group-${menu.id.split('-')[1]}`,
            );

            selectedGroup.classList.add('se-popup');
            selectedGroup.classList.add(
              se.options.toolbarBottom ? 'se-popup-bottom' : 'se-popup-top',
            );

            se.setMenuOffset(menu, selectedGroup);

            if (selectedGroup.dataset.open === 'false') {
              // close opened groups
              se.toolbarGroups.forEach(group => {
                if (group && group.dataset.open === 'true') {
                  group.classList.remove('se-popup-open');
                  group.style.display = 'none';
                  group.dataset.open = 'false';
                }
              });

              // open group
              selectedGroup.classList.add('se-popup-open');
              se.addPopupEscapeHandler();
              selectedGroup.style.display = 'block';
              selectedGroup.dataset.open = 'true';
            } else {
              selectedGroup.classList.remove('se-popup-open');
              se.removePopupEscapeHandler();
              selectedGroup.style.display = 'none';
              selectedGroup.dataset.open = 'false';
            }
          }

          if (menu) {
            // menu.style.padding = '0 10px';
            menu.style.cursor = 'pointer';
            menu.style.userSelect = 'none';

            menu.style.display = isResponsive ? 'flex' : 'none';
            menu.onclick = e => {
              se.closeAllMenus();
              toggleMenu();
              se.body.focus();
            };
          }
        });

        [...se.toolbar.getElementsByClassName('se-toolbar-selection')]
          .forEach(sl => {
            const respond = se.editor.offsetWidth < 500; 
            sl.style.display = respond ? 'none' : null;
            const { nextElementSibling } = sl;
            if(nextElementSibling.classList.contains('se-divider-section')) {
              nextElementSibling.style.display = respond ? 'none' : null;  
            }
          })

      }

      function setResponsive() {
        let responsive = window.matchMedia('(max-width: 700px)').matches;

        responsiveGroups(responsive || se.editor.offsetWidth < 1000);
      }

      setResponsive();

      const ro = new ResizeObserver(e => {
        se.closeAllMenus();
        setResponsive();
      });

      ro.observe(se.editor);
    } else {
      function responsiveMinimal(responsive) {
        const textDecorationMenu = se.toolbar.querySelector(
          '#menu-textDecoration',
        );
        const textDecorationGroup = se.toolbar.querySelector(
          '#group-textDecoration',
        );

        textDecorationMenu.onclick = () => {
          setTimeout(() => {
            const textdecorationPopup = se.toolbar.querySelector(
              '#group-textDecoration',
            );
            let isOpen = textdecorationPopup.classList.contains(
              'se-popup-open',
            );

            if (responsive) {
              if (isOpen) {
                textDecorationGroup.classList.remove('se-popup-open');
              } else {
                textDecorationGroup.classList.add('se-popup-open');
              }
            }
          }, 10);
        };

        if (responsive) {
          textDecorationMenu.style.display = 'inline-block';
          textDecorationGroup.classList.add('se-popup');
          textDecorationGroup.classList.add(
            se.options.toolbarBottom ? 'se-popup-bottom' : 'se-popup-top',
          );
        } else {
          textDecorationMenu.style.display = 'none';
          textDecorationGroup.classList.remove('se-popup');
        }
       
      }

      function hideOption(option) {
        const optionEl = se.toolbar.querySelector(`#toolbar-${option}`);
        optionEl && (optionEl.style.display = 'none');
      }

      se.toolbarMenus.forEach(menu => menu && (menu.style.display = 'none'));

      hideOption('strikethrough');
      hideOption('image');
      hideOption('insertOrderedList');
      hideOption('textAlign');
      hideOption('removeFormat');

      if (
        se.toolbarTemplate
          ? se.toolbarTemplate.offsetWidth +
              se.toolbarOptionsGroup.offsetWidth >
            se.editor.offsetWidth
          : se.toolbarOptionsGroup.offsetWidth > se.editor.offsetWidth
      ) {
        responsiveMinimal(true);
      } else {
        responsiveMinimal(false);
      }

      const ro = new ResizeObserver(e => {
        se.closeAllMenus();

        if (se.editor.offsetWidth < 300) {
          responsiveMinimal(true);
        } else {
          responsiveMinimal(false);
        }
      });

      ro.observe(se.editor);
    }
  }

  /**
   * Initilizes the overflow properties of the editor
   */
  initOverflow() {
    const se = this; 

    const onFocus = se.body.onfocus;
    se.body.onfocus = () => {
      onFocus && onFocus();
      se.overflow();
    };

    const onBlur = se.body.onblur;
    se.body.onblur = () => {
      onBlur && onBlur();
      se.overflow();
    };

    const bodyKeypress = se.body.onkeypress;
    se.body.onkeypress = () => {
      bodyKeypress && bodyKeypress();
      se.overflow();
    };
  }

  /**
   * Gets the attached files of the editor
   * @returns {Array} Returns an array of attached files to the editor
   */
  getFiles() {
    const se = this; 
    return se.files;
  }

  /**
   * Gets the content of the editor if there are attached files or provided content
   * @returns {String} Returns the HTML String of the editor's content
   */
  getContent() {
    const se = this;
    const body = se.pruneScripts(se.body);  
    const text = body.textContent;

    if (text || se.body.getElementsByTagName('img').length) {
      const htmlView = !!se.editor.querySelector('.se-html'); 
      return htmlView ? text : body.innerHTML;
    } else {
      return null;
    }
  }

  /**
   * Get the range of the window
   * @returns {Range} Range of the window
   */
  getRange() {
    try {
      const selection = window.getSelection();
      if (selection) {
        return window.getSelection().getRangeAt(0);
      }
    } catch (e) {}
  }

  /**
   * Gets the meta data from the metaUrl option
   * @param {String} url Url to fetch meta data from
   * @returns {Promise} Returns a promise that has the resolves with the meta data object
   */
  getMeta(url) {
    const se = this; 
    return fetch(se.options.metaUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({targetUrl: url}),
    }).then(res => res.json());
  }

  /**
   * Gets the image path from the imageUrl option
   * @param {String} imageEncoding Encoded image string
   * @returns {Promise} Returns a promise that resolves with the image path
   */
  getImage(imageEncoding) {
    const se = this; 
    return fetch(se.options.imageUrl, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({imageEncoding}),
    }).then(res => res.json());
  }

  /**
   * Gets the editors active options based on UI
   * @returns {Array} Returns an array with the toolbar commands currently active
   */
  getActiveOptions() {
    const se = this; 
    return [...se.toolbarOptions]
      .filter(opt => opt.classList.contains('se-toolbar-option-active'))
      .map(opt => opt.id.split('-').pop());
  }

  /**
   * String to validate url pattern
   * @param {String} str
   * @returns {Boolean} Returns true if url is valid
   */
  validURL(str) {
    const pattern = /^(?:http(s)?:\/\/)[\w.-]+(?:\.[\w\.-]+)+[\w\-\._~:/?#[\]@!\$&'\(\)\*\+,;=.]+$/;
    return pattern.test(str);
  }

  /**
   * Checks if the content overflows and removes or provides scrollbar
   */
  overflow() {
    const se = this; 

    const body = se.body;
    body.scrollHeight > body.clientHeight
      ? (body.style.overflowY = 'scroll')
      : (body.style.overflowY = 'hidden');
    body.scrollWidth > body.clientWidth
      ? (body.style.overflowX = 'scroll')
      : (body.style.overflowX = 'hidden');
  }

  /**
   * Prunes scripts from an elemenet
   * @param {HTMLElement} el Element to prune scripts from
   * @returns {HTMLElement} Returns the sanitized element
   */
  pruneScripts(el) {
    const scripts = [...el.querySelectorAll('script')];
    scripts.forEach(script => script.remove());

    return el;
  }

  /**
   * Prunes styles from an element
   * @param {HTMLElement} el Element to prune styles from
   * @returns {HTMLElemenet} Returns the sanitized element
   */
  pruneStyles(el) {
    const styles = [...el.querySelectorAll('style')];
    styles.forEach(style => style.remove());

    return el;
  }

  /**
   * Prunes inline position styles from elements
   * @param {HTMLElement} el Element to prune inline styles from
   * @returns {HTMLElement} Reutrns the sanitized element
   */
  pruneInlineStyles(el) {
    let inlineStyleNodes = [...el.querySelectorAll('[style]')];
    inlineStyleNodes = inlineStyleNodes.filter(node => node.style.position);
    inlineStyleNodes.forEach(node => (node.style.position = 'static'));
    return el;
  }

  /**
   * Denormalizes provided bytes into human readable string
   * @param {Number} bytes
   * @param {Number} decimals
   * @returns {String} Human readable file size string
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Validates file based on provided extensions. If no extensions are provided, defaults
   * to a predefined array.
   * @param {File} file File to validate
   * @returns {Boolean} Returns true if file is valid
   */
  validateFile(file) {
    const se = this; 

    const extension =
      file &&
      file.name
        .split('.')
        .pop()
        .toLowerCase();
    if (extension) {
      return se.options.extensions.includes(`.${extension}`);
    } else {
      return false;
    }
  }

  /**
   * Attaches file to the editor
   * @param {File} file File to attach to editor
   */
  attachFile(file) {
    const se = this; 

    if (se.validateFile(file)) {
      se.files.push(file);
      se.createFileElement(file.name, se.formatBytes(file.size));
      se.options.onValidFile && se.option.onValidFile();
    } else {
      se.fileInvalid();
    }
  }

  /**
   * Fires the file invalid animation on the editor
   */
  fileInvalid() {
    const se = this; 

    se.options.onInvalidFile && se.options.onInvalidFile();
    se.body.style.transition = 'background-color .5s';
    se.body.style.backgroundColor = '#e3bdbd';
    setTimeout(() => {
      se.body.style.backgroundColor = 'inherit';
      setTimeout(() => (se.body.style.transition = 'none'), 500);
    }, 500);
  }

  /**
   * Sets the offset of the popup menu based on the button
   * @param {HTMLElement} button Button to set offset for
   * @param {HTMLElement} menu Popup menu to set offset on
   */
  setMenuOffset(button, menu) {
    const se = this; 

    const editorRect = se.editor.getClientRects()[0];
    const buttonRect = button.getClientRects()[0];
    const buttonOffset = buttonRect.left - editorRect.left;
    const menuRight = buttonOffset + menu.clientWidth;

    let offset;
    if (menuRight > se.editor.clientWidth) {
      offset = buttonOffset + (se.editor.clientWidth - menuRight);
    } else {
      offset = buttonOffset;
    }

    menu.style.left = `${offset}px`;
  }

  /**
   * Opens the editor's link menu popup
   */
  openLinkMenu() {
    const se = this; 

    se.closeAllMenus();

    se.setMenuOffset(
      se.toolbar.querySelector('#toolbar-link'),
      se.linkMenu,
    );
    se.linkMenu.classList.add('se-popup-open');

    se.linkMenu.dataset.active = 'true';
    se.addPopupEscapeHandler();

    const submitEvt = e => {
      if (e.key === 'Enter') {
        const submitEl = se.linkMenu.querySelector('button');
        submitEl.click();
        e.preventDefault();
        window.removeEventListener('keyup', se.linkMenu.submitEvt);
      }
    };

    se.linkMenu.submitEvt = submitEvt;
    window.addEventListener('keyup', se.linkMenu.submitEvt);
  }

  /**
   * Opens the editor's image menu popup
   */
  openImageMenu() {
    const se = this;  

    se.closeAllMenus();

    se.setMenuOffset(
      se.toolbar.querySelector('#toolbar-image'),
      se.imageMenu,
    );
    se.imageMenu.classList.add('se-popup-open');

    se.imageMenu.dataset.active = 'true';
    se.addPopupEscapeHandler();

    const submitEvt = e => {
      if (e.key === 'Enter') {
        const submitEl = se.imageMenu.querySelector('button');
        submitEl.click();
        e.preventDefault();
        window.removeEventListener('keyup', se.imageMenu.submitEvt);
      }
    };

    se.imageMenu.submitEvt = submitEvt;
    window.addEventListener('keyup', se.imageMenu.submitEvt);
  }

  openTableMenu() {
    const se = this; 

    se.closeAllMenus();

    se.setMenuOffset(
      se.toolbar.querySelector('#toolbar-table'),
      se.tableMenu,
    );
    se.tableMenu.classList.add('se-popup-open');

    se.tableMenu.dataset.active = 'true';
    se.addPopupEscapeHandler();

    const submitEvt = e => {
      if (e.key === 'Enter') {
        const submitEl = se.tableMenu.querySelector('button');
        submitEl.click();
        e.preventDefault();
        window.removeEventListener('keyup', se.tableMenu.submitEvt);
      }
    };

    se.tableMenu.submitEvt = submitEvt;
    window.addEventListener('keyup', se.tableMenu.submitEvt);
  }

  /**
   * Closes the editor's link menu popup
   */
  closeLinkMenu() {
    const se = this; 

    se.closeAllMenus();
    se.linkMenu.classList.remove('se-popup-open');
    se.linkMenu.dataset.active = 'false';
    se.removePopupEscapeHandler();
  }

  /**
   * Closes the editor's image menu popup
   */
  closeImageMenu() {
    const se = this; 

    se.closeAllMenus();
    se.imageMenu.classList.remove('se-popup-open');
    se.imageMenu.dataset.active = 'false';
    se.removePopupEscapeHandler();
  }

  closeTableMenu() {
    const se = this; 

    se.closeAllMenus();
    se.tableMenu.classList.remove('se-popup-open');
    se.tableMenu.dataset.active = 'false';
    se.removePopupEscapeHandler();
  }

  /**
   * Closes all menus opended on the editor instance
   */
  closeAllMenus() {
    const se = this; 

    const popups = se.editor.getElementsByClassName('se-popup');
    [...popups].forEach(popup => {
      popup.classList.remove('se-popup-open');

      if (popup.submitEvt) {
        window.removeEventListener('keyup', popup.submitEvt);
      }
    });
  }

  /**
   * Binds the escape handler event
   * @param {Event} evt Event to bind to
   */
  popupEscapeHandler(evt) {
    const se = this; 

    if (evt.which === 27) {
      //close all open popups
      se.closeAllMenus();
    }
  }

  /**
   * Binds the escape handler to the editor for popup menus
   */
  addPopupEscapeHandler() {
    const se = this; 

    se.removePopupEscapeHandler();
    se.editor.addEventListener('keyup', se.bound_popupEscapeHandler);
  }

  /**
   * Removes the escape handler on the editor for popup menus
   */
  removePopupEscapeHandler() {
    const se = this; 
    se.editor.removeEventListener('keyup', se.bound_popupEscapeHandler);
  }

  /**
   * Clears the editor and sets the its content with html string
   * @param {String} html Html string to set the content with
   */
  setContent(html) {
    const se = this; 

    se.clearContent();
    if (html) {
      se.body.innerHTML = html;
      [...se.body.querySelectorAll('a')].forEach(
        link => (link.parsed = true),
      );
    }
  }

  /**
   * Removes ranges on the window and sets it to the provided range
   * @param {Range} range Range to set the window with
   */
  setRange(range) {
    const se = this; 

    try {
      if (range) {
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
      } else {
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(se.range);
      }
    } catch (e) {}
  }

  /**
   * Clears the editors content
   */
  clearContent() {
    const se = this; 
    se.body.innerHTML = '';
  }

  /**
   * Clears all attached files to the editor
   */
  clearFiles() {
    const se = this; 
    se.files = [];
    se.filesSection.innerHTML = '';
  }

  /**
   * Gets the text content of the editor
   * @returns {String} Returns text content of the editor
   */
  getTextContent() {
    const se = this; 
    return se.body.textContent;
  }

  /**
   * Sanitizes the provided element
   * @param {HTMLElement} html Element to sanitize
   * @returns {HTMLElement} Cleaned HTML node
   */
  scrubHTML(html) {
    const dirtyNode = document.createElement('div');
    const cleanNode = document.createElement('div');

    dirtyNode.innerHTML = html;
    cleanNode.append(document.createTextNode(dirtyNode.textContent));

    return cleanNode;
  }

  /**
   * Sets the toolbars stated based on which options are enabled on the document
   */
  toolbarState() {
    const se = this; 
    se.options.toolbarOptions.forEach(option => {
      if (typeof option === 'string') {
        const toolbarOption = se.toolbar.querySelector(`#toolbar-${option}`);
        if (
          !option.toLowerCase().includes('justify') &&
          !option.toLowerCase().includes('list')
        ) {
          if (document.queryCommandState(option)) {
            toolbarOption &&
              toolbarOption.classList.add('se-toolbar-option-active');
            // toolbarOption.querySelector('path').setAttribute('fill', se.options.activeOptionColor);
          } else {
            toolbarOption &&
              toolbarOption.classList.remove('se-toolbar-option-active');
            // toolbarOption.querySelector('path').setAttribute('fill', '#333');
          }
        }
      }
    });
  }

  /*
   * Update the font states on the toolbar
   */
  setFontStates() {
    const se = this;  
    if (se.fontSize && !se.browser.isFirefox()) {
      se.fontSize.textContent =
        FONTSIZES[document.queryCommandValue('fontSize')] || '(inherited size)';
    }

    if (se.fontName) {
      const currentfont = document
        .queryCommandValue('fontName')
        .split(',')[0]
        .replace(/\"/g, '');

      se.fontName.textContent = currentfont || '(inherited font)';
    }

    se.foreColor &&
      se.foreColor.setAttribute(
        'fill',
        document.queryCommandValue('foreColor'),
      );
    se.hiliteColor &&
      !se.browser.isFirefox() &&
      se.hiliteColor.setAttribute(
        'fill',
        document.queryCommandValue('hiliteColor'),
      );
  }

  /*
   * Execute current state of the fonts as displayed in the toolbar
   */
  execFontStates() {
    const se = this;

    if (se.browser.isFirefox() || se.browser.isEdge()) {
      se.foreColor &&
        document.execCommand(
          'foreColor',
          false,
          se.foreColor.getAttribute('fill'),
        );
      se.hiliteColor &&
        document.execCommand(
          'hiliteColor',
          false,
          se.hiliteColor.getAttribute('fill'),
        );
      se.fontName &&
        document.execCommand('fontName', false, se.fontName.textContent);
      se.fontSize &&
        document.execCommand(
          'fontSize',
          false,
          se.fontSize.textContent.split(' ')[0],
        );
    } else {
      se.foreColor &&
        document.execCommand(
          'foreColor',
          true,
          se.foreColor.getAttribute('fill'),
        );
      se.hiliteColor &&
        document.execCommand(
          'hiliteColor',
          true,
          se.hiliteColor.getAttribute('fill'),
        );

      se.fontName &&
        document.execCommand('fontName', true, se.fontName.textContent);
      se.fontSize &&
        document.execCommand(
          'fontSize',
          true,
          parseInt(se.fontSize.dataset.command),
        );
    }
  }

  generateTable(cols = 3, rows = 3) {
    const se = this; 

    let table = document.createElement('table');

    for (let i = 0; i < rows; i++) {
      table.insertRow();
    }

    [...table.rows].forEach(r => {
      for (let i = 0; i < cols; i++) {
        r.insertCell();
      }
    });

    table.setAttribute('data-init', true);
    se.executeCommand('insertHTML', table.outerHTML);

    table = se.body.querySelector('table[data-init="true"]');
    if (table) {
      table.removeAttribute('data-init');
      table.setAttribute('cellspacing', '0');
      table.setAttribute('style', 'width: 100%');

      const tdCollection = [...table.getElementsByTagName('td')];
      tdCollection.forEach(td => {
        td.setAttribute('style', 'border: 1px solid #ddd');

        td.onfocus = () => {
          se.toolbarState();
        };

        td.onclick = () => {
          const range = se.getRange();
          td.textContent && range.selectNode(td);
          se.toolbarState();
        };
      });
    }

    return table;
  }

  /**
   * This method is used to detect the user browser and environment
   */
  establishBrowser() {
    const se = this; 

    const userAgent = ((navigator && navigator.userAgent) || '').toLowerCase();
    const vendor = ((navigator && navigator.vendor) || '').toLowerCase();

    const comparator = {
      '<': function(a, b) {
        return a < b;
      },
      '<=': function(a, b) {
        return a <= b;
      },
      '>': function(a, b) {
        return a > b;
      },
      '>=': function(a, b) {
        return a >= b;
      },
    };

    const compareVersion = (version, range) => {
      const str = range + '';
      const n = +(str.match(/\d+/) || NaN);
      const op = str.match(/^[<>]=?|/)[0];
      return comparator[op]
        ? comparator[op](version, n)
        : version == n || n !== n;
    };

    se.browser = {
      userAgent,
      vendor,
    };

    // detect opera
    se.browser.isOpera = function isOpera(range) {
      const match = userAgent.match(/(?:^opera.+?version|opr)\/(\d+)/);
      return match !== null && compareVersion(match[1], range);
    };

    // detect chrome
    se.browser.isChrome = function isChrome(range) {
      const match = /google inc/.test(vendor)
        ? userAgent.match(/(?:chrome|crios)\/(\d+)/)
        : null;
      return (
        match !== null && !se.isOpera() && compareVersion(match[1], range)
      );
    };

    // detect firefox
    se.browser.isFirefox = function isFirefox(range) {
      const match = userAgent.match(/(?:firefox|fxios)\/(\d+)/);
      return match !== null && compareVersion(match[1], range);
    };

    // detect safari
    se.browser.isSafari = function isSafari(range) {
      const match = userAgent.match(/version\/(\d+).+?safari/);
      return match !== null && compareVersion(match[1], range);
    };

    // detect internet explorer
    se.browser.isIE = function isIE(range) {
      const match = userAgent.match(/(?:msie |trident.+?; rv:)(\d+)/);
      return match !== null && compareVersion(match[1], range);
    };

    // detect edge
    se.browser.isEdge = function isEdge(range) {
      const match = userAgent.match(/edge\/(\d+)/);
      return match !== null && compareVersion(match[1], range);
    };

    // detect blink engine
    se.browser.isBlink = function isBlink() {
      return (se.isChrome() || se.isOpera()) && !!window.CSS;
    };
  }

  /**
   * Checks if editor is being focused on (inclusive to children and relative elements)
   * @returns {Boolean} Returns true if editor is being focused
   */
  isEditorInFocus() {
    const se = this; 

    let activeEl = document.activeElement;
    var isEditor = el => {
      if (el === se.editor) {
        return true;
      } else if (el === document.body) {
        return false;
      }
      return el.parentNode && isEditor(el.parentNode);
    };
    return isEditor(activeEl);
  }

  /**
   * Sets links in the editor to open new windows
   */
  setLinkTarget() {
    const links = [...se.body.querySelectorAll('a')];
    if (links.length) {
      links.forEach(link => {
        if (!link.onclick || link.href) {
          link.setAttribute('target', '_blank');
        }
      });
    }
  }

  /**
   * Convert and select links
   * @param {Boolean} Select the last link
   */
  convertAndSelectLinks(sel = true) {
    const se = this;
    linkify(se.body, {}, document);

    const linkElements = se.body.getElementsByTagName('a');

    if (linkElements.length > 0) {
      const links = [...linkElements];
      const convertedLinks = [];
      links.forEach(link => {
        if (link.parsed) {
          return false;
        }

        const href = link.getAttribute('href');
        const isEmail = href ? href.includes('mailto') : false;
        const isLinkified =
          link.classList.contains('linkified') &&
          !se.validURL(href || link.textContent);

        if (href && (isEmail || isLinkified)) {
          link.outerHTML = link.textContent;
        } else {
          link.onmousemove = e => {
            e.ctrlKey && (link.style.cursor = 'pointer');
          };

          link.onclick = e => {
            if (e.ctrlKey) {
              const anchor = document.createElement('a');
              anchor.setAttribute('href', link.getAttribute('href'));
              anchor.setAttribute('target', '_blank');
              document.body.append(anchor);
              anchor.click();
              anchor.remove();
            }
          };

          link.onmouseleave = () => (link.style.cursor = null);

          convertedLinks.push(link);
        }

        link.classList.remove('linkified');
        link.setAttribute('target', '_blank');
      });

      if (sel) {
        const range = se.getRange();
        range.selectNode(convertedLinks.pop());
        range.collapse();
      }
    }

    setTimeout(() => {
      // Trigger oninput event
      if (se.body.oninput) {
        se.body.oninput();
      }
    }, 10);
  }

  /*
   * Init Pickr Plugin menu for font colors
   * @param {Object} Pickr instance
   * @param {Function} Handler even for the select button
   */
  initPickrMenu(pickr, onclick) {
    const pickrMenu = pickr['_root']['app'];

    const pickrMenuActions = document.createElement('div');
    const pickrMenuButton = document.createElement('button');
    const pickrMenuClose = document.createElement('button');

    pickrMenuButton.setAttribute('type', 'button');
    pickrMenuClose.setAttribute('type', 'button');

    pickrMenuActions.setAttribute(
      'style',
      'display: flex; justify-content: flex-end; margin-top: 10px;',
    );

    pickrMenuButton.textContent = 'Select';
    pickrMenuClose.textContent = 'Close';

    pickrMenuButton.classList.add('se-popup-button');
    pickrMenuButton.classList.add('se-button-primary');
    pickrMenuClose.classList.add('se-popup-button');
    pickrMenuClose.classList.add('se-button-secondary');

    pickrMenuClose.onclick = () => pickr.hide();

    pickrMenuButton.onclick = onclick;

    pickrMenuActions.append(pickrMenuButton);
    pickrMenuActions.append(pickrMenuClose);
    pickrMenu.append(pickrMenuActions);
  }

  /**
   * Executes a command on the document with respect to browser
   * @param {String} command Command to execute on the document
   */
  executeCommand(command, input) {
    const se = this;

    switch (command) {
      case 'html':
        const saveoption = document.createElement('div');
        saveoption.classList.add('se-toolbar-option');
        saveoption.setAttribute('title', 'Design');
        saveoption.append(createSVG(DESIGNICON));

        se.toolbar.classList.add('se-html');

        saveoption.onclick = () => {
          saveoption.remove();
          se.body.style.fontFamily = null;

          se.toolbar.classList.remove('se-html');
          se.setContent(se.body.textContent);
        };

        se.toolbar.prepend(saveoption);

        se.body.style.fontFamily = 'Courier';
        se.body.textContent = se.body.innerHTML;
        break;
      case 'fullscreen':
        const opt = se.toolbar.querySelector('#toolbar-fullscreen');
        
        if(!se.editor.oncollapse) {
          se.editor.oncollapse = () => {
            if(opt.original !== se.body.innerHTML && se.options.change) {
              se.options.change(se.getContent());
            }

            opt.innerHTML = '';
            opt.append(createSVG(EXPANDICON));
          
            se.overflow();
            se.editor.style.maxHeight = null;
            
            se.body.style.height = se.editor.getAttribute('height');
            se.body.style.minHeight = se.editor.getAttribute('min-height');
            se.body.style.maxHeight = se.editor.getAttribute('max-height');

            opt.removeAttribute('data-fullscreen');
          };
        }

        if (opt.getAttribute('data-fullscreen')) {
            se.editor.collapse && se.editor.collapse();
        } else {
          blowUpElement(se.editor, '#fff', e => {
            opt.original = se.body.innerHTML; 
            opt.innerHTML = '';
            opt.append(createSVG(COLLAPSEICON));
           
            se.body.style.overflow = null;
            
            se.body.style.height = null;
            se.body.style.minHeight = null;
            se.body.style.maxHeight = null;

            se.editor.style.maxHeight = 'inherit';
            opt.setAttribute('data-fullscreen', 'active');
          });
        }
        break;
      case 'foreColor':
      case 'hiliteColor':
        const colorOption = se.toolbar.querySelector(`#toolbar-${command}`);
        const colorIcon = colorOption.getElementsByTagName('path')[0];
        se[command] = colorIcon;

        const defaultColor = () => {
          if (command === 'foreColor') {
            return '#000';
          }

          if (command === 'hiliteColor') {
            return '#fff';
          }

          return '#000';
        };

        if (colorOption.dataset.init !== 'true') {
          const pickr = Pickr.create({
            el: colorOption,
            theme: 'classic',
            container: se.editor,
            useAsButton: true,
            default: defaultColor(),
            components: {
              preview: true,
              palette: true,
              hue: true,
              interaction: {hex: true, input: true},
            },
          });

          se.initPickrMenu(pickr, () => {
            const color = pickr
              .getColor()
              .toHEXA()
              .toString();

            function execute() {
              if (se.browser.isEdge() || se.browser.isFirefox()) {
                document.execCommand(command, false, color);
              } else {
                document.execCommand(command, true, color);
              }
            }

            colorIcon.setAttribute('fill', color);

            const enabler = () => {
              execute();
              se.body.removeEventListener('keydown', enabler);
            };

            if (se.range) {
              if (se.range.collapsed) {
                se.body.addEventListener('keydown', enabler);
              } else {
                execute();
              }
            } else {
              se.body.addEventListener('keydown', enabler);
            }

            pickr.hide();
          });

          pickr.on('init', p => {
            colorOption.dataset.init = 'true';
            pickr.show();
          });

          pickr.on('change', (h, p) => {
            const color = h.toHEXA().toString();
            colorIcon.setAttribute('fill', color);
          });

          pickr.on('hide', p => {
            const color = p
              .getColor()
              .toHEXA()
              .toString();

            se.body.focus();
          });

          pickr.on('show', p => {
            const { app } = p['_root'];
            if(window.matchMedia('(max-width: 510px)').matches) {
              app.style.left = null;
            }
          });
        }
        break;
      case 'insertOrderedList':
        if(!se.body.textContent) {
          const list = document.createElement('ol');
          const item = document.createElement('li'); 
          list.append(item);
          
          se.body.append(list); 
          
          const r = se.range || new Range();
          window.getSelection().removeAllRanges(); 
          window.getSelection().addRange(r);
          r.selectNode(item);

          return false;
        }

        if (se.browser.isFirefox() || se.browser.isEdge()) {
          document.execCommand(command, false);
        } else {
          document.execCommand(command);
        }
        break;
      case 'insertUnorderedList':
        if(!se.body.textContent) {
          const list = document.createElement('ul');
          const item = document.createElement('li'); 
          list.append(item);
          
          se.body.append(list); 
          
          const r = se.range || new Range();
          window.getSelection().removeAllRanges(); 
          window.getSelection().addRange(r);
          r.selectNode(list);

          return false;
        }

        if (se.browser.isFirefox() || se.browser.isEdge()) {
          document.execCommand(command, false);
        } else {
          document.execCommand(command);
        }
        break;
      case 'attachment':
        const attachmentInput = document.createElement('input');
        attachmentInput.style.display = 'none';
        attachmentInput.type = 'file';
        attachmentInput.multiple = true;
        attachmentInput.style.visibility = 'hidden';
        attachmentInput.style.display = 'none';
        document.body.append(attachmentInput);
        attachmentInput.onchange = e => {
          [...attachmentInput.files].forEach(file => se.attachFile(file));
          attachmentInput.remove();
        };
        attachmentInput.click();
        break;
      case 'link':
        if (se.linkMenu.dataset.active === 'true') {
          se.closeLinkMenu();
        } else {
          se.openLinkMenu();

          setTimeout(() => {
            const selection = se.linkMenu.querySelector(
              'input[placeholder="Text content"]',
            );
            selection && (selection.value = document.getSelection().toString());

            se.linkMenu.querySelector('input').select();
          }, 100);
        }
        break;
      case 'image':
        if (se.imageMenu.dataset.active === 'true') {
          se.closeImageMenu();
        } else {
          se.openImageMenu();

          se.range = se.getRange();
          setTimeout(() => se.imageMenu.querySelector('input').focus(), 100);
        }
        break;
      case 'table':
        if (se.tableMenu.dataset.active === 'true') {
          se.closeTableMenu();
        } else {
          se.openTableMenu();

          se.range = se.getRange();
          setTimeout(() => se.tableMenu.querySelector('input').focus(), 100);
        }
        break;
      default:
        if (se.browser.isFirefox() || se.browser.isEdge()) {
          input
            ? document.execCommand(command, false, input)
            : document.execCommand(command);
        } else {
          input
            ? document.execCommand(command, true, input)
            : document.execCommand(command, true);
        }
        break;
    }

    if (command === 'indent') {
      [...se.body.getElementsByTagName('blockquote')].forEach(bq => {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = bq.outerHTML;
        bq.replaceWith(wrapper);
      });
    }
  }
}
