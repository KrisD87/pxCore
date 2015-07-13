var px = require("./build/Debug/px");
var http = require('http');
var util = require('util');


function secureRequire(pkg)
{
  // TODO: do whitelist/validate import here
  return require(pkg);
}

function Api(scene) {
  this._scene = scene;
}

Api.prototype.destroyNodeFromScene = function(scene, node) {
  if (node) {
    var children = node.children;
    if (children) {
      var n = children.length;
      for (var i = 0; i < n; ++i) {
        this.destroyNodeFromScene(scene, node.getChild(0));
      }
    }
    node.remove();
  }
}

Api.prototype.destroyScene = function(scene) {
  if (scene) {
    this.destroyNodeFromScene(scene, scene.root);
    scene.url = "";
    scene.parent = null;
  }
}

Api.prototype.loadScriptContents = function(uri, closure) {
  var fs = require('fs');
  var url = require('url');

  var code = '';

  if (uri.substring(0, 4) == "http") {
    var options = url.parse(uri);
    if (uri.substring(0, 5) == "https") {
      throw 'not supported'
    }
    else {
      var req = http.get(options, function(res) {
        res.on('data',  function(data)  { code += data; });
        res.on('end',   function()      { closure(code, null); });
      });
      req.on('error',   function(err)   { closure('', err); });
    }
  }
  else {
    var infile = fs.createReadStream(uri);
    infile.on('data',  function(data)   { code += data; });
    infile.on('end',   function()       { closure(code, null); });
    infile.on('error', function(err)    { closure('', err); });
  }
}

Api.prototype.loadScriptForScene = function(container, scene, uri) {
  var sceneForChild = scene;
  var apiForChild = this;
  var code;

  // TODO: This is the name that will show up in stack traces. We should
  // resolve ./ to full paths (maybe).
  var fname = uri;

  try {
    code = this.loadScriptContents(uri, function(code, err) {
      var vm = require('vm');
      var sandbox = {
        console   : console,
        scene     : sceneForChild,
        runtime   : apiForChild,
        process   : process,
        require   : secureRequire,
        setTimeout: setTimeout,
      };

      if (err) {
        console.log("failed to load script:" + uri);
        console.log(err);
        // TODO: scene.onError(err); ???
      }
      else {
        try {
          // TODO: This form will not work until nodejs >= 0.12.x
          // var opts = { filename: fname, displayError: true };
          var script = new vm.Script(code, fname);
          script.runInNewContext(sandbox);

          // TODO do the old scenes context get released when we reload a scenes url??
            
          // TODO part of an experiment to eliminate intermediate rendering of the scene
          // while it is being set up
          if (true) { // enable to fade scenes in
            container.a = 0;
            container.painting = true;
            container.animateTo({a:1}, 0.2, 0, 0);
          }
          else
            container.painting = true;
        }
        catch (err) {
          console.log("failed to run app:" + uri);
          console.log(err);

          // TODO: scene.onError(err); ???
          // TODO: at this point we need to destroy the child scene
          scene.url = "";  // This destroys the child scene and releases scene.ctx
          apiForChild.destroyScene(sandbox.scene);

          sandbox.console = null;
          sandbox.scene = null;
          sandbox.runtime = null;
          sandbox.process = null;

          // console.log(util.inspect(sandbox));
        }
      }
    });
  }
  catch (err) {
    console.log("failed to load script:" + uri);
    console.log(err);
    // TODO: scene.onError(err); ???
  }
}

function readConfigFile(argv)
{
  var fs = require('fs');
  var path = require('path');
  var configSettings = {};
  var argvLength = argv.length;
  for (var i = 0; i < argvLength; i++) {
      if (argv[i].indexOf("-config=") > -1)
      {
        var configString = argv[i].split("-config=");
        if (configString.length > 1)
        {
          var configFileName = argv[i].split("-config=")[1];
          var configPath = path.join(__dirname, configFileName);
          if (configFileName.length > 0 && fs.existsSync(configPath))
          {
            configSettings = JSON.parse(fs.readFileSync(configPath, { encoding: 'utf8' }));
            break;
          }
        }
      }
  }
  
  return configSettings;
}

var scene = px.getScene(0, 0, 800, 400);
var api = new Api(scene);

// register a "global" hook that gets invoked whenever a child scene is created
scene.onScene = function(container, innerscene, url) {
    // TODO part of an experiment to eliminate intermediate rendering of the scene
    // while it is being set up
    // container when returned here has it's painting property set to false.
    // it won't start rendering until we set painting to true which we do 
    // after the script has loaded
    api.loadScriptForScene(container,innerscene, url);
};

var argv = process.argv;

if (argv.length >= 3) {
    var configJson = readConfigFile(argv);
    var originalURL = argv[2];
    // TODO - WARNING root scene.create* doesn't allow passing in property bags
    configJson["parent"] = scene.root;
    configJson["url"] = originalURL;
    var childScene = scene.createScene(configJson);
  scene.setFocus(childScene);
/*
    childScene.url = originalURL;
    childScene.parent = scene.root;
*/
    var fpsBg = scene.createRectangle({fillColor:0x00000080,lineColor:0xffff0080,lineWidth:3,x:10,y:10,a:0,parent:scene.root});
    var fpsCounter = scene.createText({x:5,textColor:0xffffffff,pixelSize:24,text:"0fps",parent:fpsBg});
        fpsBg.w = fpsCounter.w+16;
        fpsBg.h = fpsCounter.h;

    function updateSize(w, h) {
        childScene.w = w;
        childScene.h = h;
    }

    scene.on("onFPS", function(e) { 
        if(fpsBg.a) {
            fpsCounter.text = ""+Math.floor(e.fps)+"fps"; 
            fpsBg.w = fpsCounter.w+16;
            fpsBg.h = fpsCounter.h;
        }
    });


  // Cursor emulation mostly for egl targets right now.

  // hacky raspberry pi detection
  var os = require("os");
  var hostname = os.hostname();
  
  if (hostname == "raspberrypi") {
    var cursor = scene.createImage({url:"cursor.png",parent:scene.root,
				                            interactive:false});
    
    scene.on("onMouseMove", function(e) {
	    cursor.x = e.x-23;
	    cursor.y = e.y-10;
    });
  }

    scene.root.on("onPreKeyDown", function(e) {
      console.log("in onKeyDown");
	    var code = e.keyCode; var flags = e.flags;
      console.log("onKeyDown:", code, ", ", flags);
      if (code == 89 && (flags & 48)) {  // ctrl-alt-y
        fpsBg.a = (fpsBg.a==0)?1.0:0;
        e.stopPropagation();
      }
      if (code == 79 && (flags & 48)) {  // ctrl-alt-o
        scene.showOutlines = !scene.showOutlines;
        e.stopPropagation();
      }
      else if (code == 82 && (flags & 16)) {  // ctrl-r
        console.log("Reloading url: ", originalURL);
        childScene.url = originalURL;
        e.stopPropagation();
      }
    });
    scene.root.on("onPreKeyUp", function(e) {
console.log("in onKeyUp");
	var code = e.keyCode; var flags = e.flags;
        console.log("onKeyUp:", code, ", ", flags);
        // eat the ones we handle here
        if (code == 89 && (flags & 48)) e.stopPropagation(); // ctrl-alt-y
        if (code == 79 && (flags & 48)) e.stopPropagation(); // ctrl-alt-o
        else if (code == 82 && (flags | 16)) e.stopPropagation(); // ctrl-r
    });


    scene.root.on("onPreChar", function(e) {
      console.log("in onchar");
	    var c = e.charCode;
      console.log("onChar:", c);
	    // TODO eating some "undesired" chars for now... need to redo this
      if (c<32) {
        //            childScene.emit("onChar", e);
        console.log("stop onChar");
        e.stopPropagation()
      }
    });


    // TODO if I log out event object e... there is extra stuff??
    scene.on("onResize", function(e) { updateSize(e.w, e.h);});
    updateSize(scene.w, scene.h);
}
else
    console.log("Usage: ./load.sh <js file>");
