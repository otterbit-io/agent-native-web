(function(){
  "use strict";

  var DEFAULT_UAS = [
    "GPTBot","ChatGPT-User","OAI-SearchBot","ClaudeBot","Claude-Web","Claude-User",
    "anthropic-ai","PerplexityBot","Perplexity-User","Google-Extended","GoogleOther",
    "CCBot","Bytespider","Amazonbot","Applebot-Extended","meta-externalagent",
    "cohere-ai","YouBot","DuckAssistBot"
  ];

  var $ = function(id){ return document.getElementById(id); };
  var state = { zip:null, name:"site.zip", outBlob:null, llmsText:"" };

  $("ua").value = DEFAULT_UAS.join("\n");

  // file intake
  var drop = $("drop"), fileInput = $("file");
  drop.addEventListener("click", function(){ fileInput.click(); });
  drop.addEventListener("keydown", function(e){ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); fileInput.click(); } });
  ["dragenter","dragover"].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add("drag"); });
  });
  ["dragleave","drop"].forEach(function(ev){
    drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove("drag"); });
  });
  drop.addEventListener("drop", function(e){
    if(e.dataTransfer.files && e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", function(){ if(fileInput.files[0]) takeFile(fileInput.files[0]); });

  function takeFile(f){
    if(!/\.zip$/i.test(f.name)){ alert("Please use a .zip file"); return; }
    state.name = f.name;
    drop.querySelector(".big").textContent = f.name;
    drop.querySelector(".sub").textContent = (f.size/1048576).toFixed(1) + " MB · ready for conversion";
    state.file = f;
    var btn = $("convert"); btn.disabled = false; btn.textContent = "Convert";
  }

  $("convert").addEventListener("click", run);

  // main pipeline
  function run(){
    if(!state.file) return;
    var btn = $("convert"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Reading ZIP…';
    $("empty").hidden = true; $("report").hidden = false;
    var log = $("log"); log.innerHTML = ""; $("download").classList.remove("show");

    var opts = {
      html:   $("opt_html").checked,
      md:     $("opt_md").checked,
      llms:   $("opt_llms").checked,
      cfg:    $("opt_cfg").checked,
      inject: $("opt_inject").checked
    };
    var uas = $("ua").value.split(/\r?\n/).map(function(s){return s.trim();}).filter(Boolean);

    state.file.arrayBuffer().then(function(buf){
      return JSZip.loadAsync(buf);
    }).then(function(zip){
      return convert(zip, opts, uas);
    }).catch(function(err){
      logRow("warn","Error: "+(err && err.message ? err.message : err),"");
      btn.disabled = false; btn.textContent = "Try again";
    });
  }

  function convert(zip, opts, uas){
    var out = new JSZip();
    var entries = [];
    zip.forEach(function(path, entry){ if(!entry.dir) entries.push({path:path, entry:entry}); });

    var htmlFiles = entries.filter(function(e){ return /\.html?$/i.test(e.path); });
    var root = commonRoot(entries.map(function(e){return e.path;}));

    var pages = [], counts = {pages:0, md:0, assets:0, words:0};

    // process sequentially to keep memory + UI predictable
    var i = 0;
    function next(){
      if(i >= entries.length){ return finish(); }
      var e = entries[i++];
      var isHtml = /\.html?$/i.test(e.path);

      if(!isHtml){
        return e.entry.async("uint8array").then(function(data){
          out.file(e.path, data);
          counts.assets++;
          if(i % 12 === 0){ $("s_assets").textContent = counts.assets; }
          return next();
        });
      }

      return e.entry.async("string").then(function(text){
        var rel = stripRoot(e.path, root);              // e.g. about/index.html
        var res = processPage(text, rel);
        pages.push({ title:res.title, url:"/"+rel, excerpt:res.excerpt, md:res.markdown });
        counts.pages++; counts.words += res.words;

        // original (optionally with alternate links injected)
        out.file(e.path, opts.inject ? res.injectedOriginal : text);

        var mirrorBase = joinRoot(root, "agent/"+rel);   // agent/about/index.html
        if(opts.html){ out.file(mirrorBase, res.agentHtml); }
        if(opts.md){
          var mdPath = mirrorBase.replace(/\.html?$/i, ".md");
          out.file(mdPath, res.markdown); counts.md++;
        }

        logRow("ok", rel, "agent/"+rel + (opts.md?" (+md)":""));
        $("s_pages").textContent = counts.pages;
        $("s_md").textContent = counts.md;
        $("s_words").textContent = counts.words.toLocaleString("de-DE");
        return next();
      });
    }

    function finish(){
      $("s_assets").textContent = counts.assets;

      if(opts.llms){
        var idx = buildLlmsIndex(pages);
        var full = buildLlmsFull(pages);
        out.file(joinRoot(root,"llms.txt"), idx);
        out.file(joinRoot(root,"llms-full.txt"), full);
        state.llmsText = idx;
        logRow("ok","(generated)","llms.txt + llms-full.txt");
      }
      if(opts.cfg){
        out.file(joinRoot(root,".htaccess"), buildHtaccess(uas));
        out.file(joinRoot(root,"agent-native-nginx.conf"), buildNginx(uas));
        logRow("ok","(generated)",".htaccess + nginx-Snippet");
      }
      out.file(joinRoot(root,"AGENT-NATIVE-README.md"), buildReadme(uas, opts));

      var btn = $("convert"); btn.innerHTML = '<span class="spin"></span>Packaging ZIP…';
      return out.generateAsync({type:"blob", compression:"DEFLATE", compressionOptions:{level:6}})
        .then(function(blob){
          state.outBlob = blob;
          $("download").classList.add("show");
          btn.disabled = false; btn.textContent = "Convert again";
          logRow("ok","done", (blob.size/1048576).toFixed(2)+" MB ready");
        });
    }

    return next();
  }

  // per-page processing
  function processPage(html, rel){
    var doc = new DOMParser().parseFromString(html, "text/html");

    var title = (doc.querySelector("title") && doc.querySelector("title").textContent.trim())
             || (doc.querySelector("h1") && doc.querySelector("h1").textContent.trim())
             || rel;

    var metaDesc = doc.querySelector('meta[name="description"]');
    var description = metaDesc ? (metaDesc.getAttribute("content")||"").trim() : "";

    var main = extractMain(doc);
    if(description === ""){
      var p = main.querySelector("p");
      if(p) description = collapse(p.textContent).slice(0,200);
    }

    var contentHtml = main.innerHTML.trim();
    var markdown = domToMarkdown(main).trim();
    var words = collapse(main.textContent).split(/\s+/).filter(Boolean).length;

    var canonical = "/" + rel;
    var mdHref = "/agent/" + rel.replace(/\.html?$/i, ".md");

    var agentHtml = buildAgentHtml({
      lang: doc.documentElement.getAttribute("lang") || "en",
      title: title, description: description, canonical: canonical,
      mdHref: mdHref, content: contentHtml, isPage: /index\.html?$/i.test(rel)
    });

    var injectedOriginal = injectAlternates(html, canonical, mdHref);

    return { title:title, excerpt:description, markdown:markdown, agentHtml:agentHtml,
             injectedOriginal:injectedOriginal, words:words };
  }

  // Pick the main content node from a cloned, de-chromed body.
  function extractMain(doc){
    var body = doc.body ? doc.body.cloneNode(true) : doc.createElement("body");
    var strip = "script,style,noscript,iframe,svg,nav,header,footer,aside,form," +
      '[role="navigation"],[role="banner"],[role="contentinfo"],.nav,.navbar,.menu,' +
      ".sidebar,.side,.footer,.site-footer,.header,.site-header,.comments,.comment,.share,.social,.cookie,.breadcrumb";
    body.querySelectorAll(strip).forEach(function(n){ n.remove(); });
    // remove inline event handlers
    body.querySelectorAll("*").forEach(function(n){
      for(var a=n.attributes.length-1; a>=0; a--){
        var name = n.attributes[a].name;
        if(/^on/i.test(name)) n.removeAttribute(name);
      }
    });

    var pick = body.querySelector("main") || body.querySelector("article") ||
               body.querySelector('[role="main"]') || body.querySelector("#content,.content,.post,.entry,.page");
    if(pick && collapse(pick.textContent).length > 40) return pick;

    // heuristic: densest block by paragraph text, penalised for link density
    var best = body, bestScore = score(body);
    body.querySelectorAll("div,section,article,main").forEach(function(el){
      var s = score(el);
      if(s > bestScore){ bestScore = s; best = el; }
    });
    return best;
  }

  function score(el){
    var text = collapse(el.textContent).length;
    var linkText = 0;
    el.querySelectorAll("a").forEach(function(a){ linkText += collapse(a.textContent).length; });
    var density = text ? linkText/text : 1;
    return text * (1 - Math.min(density, 0.9));
  }

  // HTML → Markdown
  function domToMarkdown(node){
    var out = "";
    node.childNodes.forEach(function(n){ out += serialize(n, 0); });
    return out.replace(/[ \t]+\n/g,"\n").replace(/^[ \t]+$/gm,"").replace(/\n{3,}/g,"\n\n").trim() + "\n";
  }
  function serialize(n, depth){
    if(n.nodeType === 3) return (n.textContent||"").replace(/\s+/g," ");
    if(n.nodeType !== 1) return "";
    var tag = n.tagName.toLowerCase();
    var inner = ""; n.childNodes.forEach(function(c){ inner += serialize(c, depth+1); });
    inner = inner.trim();
    switch(tag){
      case "h1": return "\n# "+inner+"\n\n";
      case "h2": return "\n## "+inner+"\n\n";
      case "h3": return "\n### "+inner+"\n\n";
      case "h4": return "\n#### "+inner+"\n\n";
      case "h5": return "\n##### "+inner+"\n\n";
      case "h6": return "\n###### "+inner+"\n\n";
      case "p": return inner ? "\n"+inner+"\n\n" : "";
      case "br": return "\n";
      case "hr": return "\n---\n\n";
      case "strong": case "b": return inner ? "**"+inner+"**" : "";
      case "em": case "i": return inner ? "_"+inner+"_" : "";
      case "code": return n.closest && n.closest("pre") ? inner : "`"+inner+"`";
      case "pre": return "\n```\n"+collapse(n.textContent).replace(/`/g,"")+"\n```\n\n";
      case "blockquote": return "\n> "+inner.replace(/\n/g,"\n> ")+"\n\n";
      case "a":
        var href = n.getAttribute("href")||"";
        return href ? "["+inner+"]("+href+")" : inner;
      case "img":
        var alt = n.getAttribute("alt")||"", src = n.getAttribute("src")||"";
        return src ? "!["+alt+"]("+src+")" : "";
      case "li": return "- "+inner+"\n";
      case "ul": case "ol": return "\n"+inner+"\n";
      default: return inner ? inner+" " : "";
    }
  }

  // builders
  function buildAgentHtml(o){
    var schema = {
      "@context":"https://schema.org",
      "@type": o.isPage ? "WebPage" : "Article",
      "headline": o.title, "url": o.canonical, "description": o.description
    };
    return "<!DOCTYPE html>\n<html lang=\""+esc(o.lang)+"\">\n<head>\n"+
      '<meta charset="utf-8">\n'+
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n'+
      "<title>"+esc(o.title)+"</title>\n"+
      (o.description ? '<meta name="description" content="'+esc(o.description)+'">\n' : "")+
      '<link rel="canonical" href="'+esc(o.canonical)+'">\n'+
      '<link rel="alternate" type="text/markdown" href="'+esc(o.mdHref)+'">\n'+
      '<script type="application/ld+json">'+JSON.stringify(schema)+'<\/script>\n'+
      "</head>\n<body>\n<main>\n<article>\n<h1>"+esc(o.title)+"</h1>\n"+
      o.content+"\n</article>\n</main>\n</body>\n</html>\n";
  }

  function injectAlternates(html, canonical, mdHref){
    var tags = '\n<link rel="alternate" type="text/markdown" href="'+esc(mdHref)+'">'+
               '\n<link rel="canonical" href="'+esc(canonical)+'">';
    if(/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tags+"\n</head>");
    return tags + "\n" + html;
  }

  function buildLlmsIndex(pages){
    var s = "# "+ (document.title || "Website") + "\n\n";
    s += "Machine-readable index. Add /agent/<path>.md or ?format for the Markdown version.\n\n## Pages\n\n";
    pages.forEach(function(p){
      s += "- ["+oneLine(p.title)+"]("+p.url+")"+(p.excerpt?": "+oneLine(p.excerpt):"")+"\n";
    });
    return s;
  }
  function buildLlmsFull(pages){
    var s = "# Full-text export\n";
    pages.forEach(function(p){
      s += "\n---\n\n# "+oneLine(p.title)+"\n\nURL: "+p.url+"\n\n"+p.md.trim()+"\n";
    });
    return s;
  }

  function uaRegex(uas){
    return uas.map(function(u){ return u.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"); }).join("|");
  }
  function buildHtaccess(uas){
    var rx = uaRegex(uas);
    return "# Agent Native — route known AI agents to the clean /agent/ mirror\n"+
      "<IfModule mod_rewrite.c>\n"+
      "  RewriteEngine On\n"+
      "  # HTML pages -> mirror\n"+
      "  RewriteCond %{HTTP_USER_AGENT} ("+rx+") [NC]\n"+
      "  RewriteCond %{REQUEST_URI} !^/agent/\n"+
      "  RewriteRule ^(.+?)\\.html?$ /agent/$1.html [L]\n"+
      "  # directory / root index -> mirror\n"+
      "  RewriteCond %{HTTP_USER_AGENT} ("+rx+") [NC]\n"+
      "  RewriteCond %{REQUEST_URI} !^/agent/\n"+
      "  RewriteRule ^(.*)/$ /agent/$1/index.html [L]\n"+
      "  RewriteCond %{HTTP_USER_AGENT} ("+rx+") [NC]\n"+
      "  RewriteCond %{REQUEST_URI} ^/$\n"+
      "  RewriteRule ^$ /agent/index.html [L]\n"+
      "</IfModule>\n"+
      "# Note: UA strings are spoofable; this is best-effort routing.\n";
  }
  function buildNginx(uas){
    var rx = uaRegex(uas);
    return "# Agent Native — nginx snippet.\n"+
      "# 1) put this map in the http { } context:\n"+
      "map $http_user_agent $agent_native {\n"+
      "    default 0;\n"+
      '    "~*('+rx+')" 1;\n'+
      "}\n\n"+
      "# 2) inside your server { } block:\n"+
      "#   location / {\n"+
      "#       if ($agent_native) { rewrite ^/(.*)\\.html$ /agent/$1.html last; }\n"+
      "#       if ($agent_native) { rewrite ^/$ /agent/index.html last; }\n"+
      "#       try_files $uri $uri/ =404;\n"+
      "#   }\n";
  }
  function buildReadme(uas, opts){
    return "# Agent Native — converted bundle\n\n"+
      "This ZIP contains your original site plus an agent-native layer:\n\n"+
      "- `/agent/…`  clean HTML mirror"+(opts.md?" and `.md` Markdown":"")+" per page, with JSON-LD and a canonical back to the human URL.\n"+
      (opts.llms?"- `llms.txt` / `llms-full.txt`  machine-readable index and full-text export.\n":"")+
      (opts.cfg?"- `.htaccess` / `agent-native-nginx.conf`  route known AI agents to the mirror.\n":"")+
      "\n## Deploy\n\n"+
      "1. Upload the whole bundle to your web root (keep the `/agent/` folder).\n"+
      "2. Apache: the `.htaccess` works if `mod_rewrite` is enabled.\n"+
      "   nginx: paste the map + location lines from `agent-native-nginx.conf`.\n"+
      "3. Test:  `curl -A \"ClaudeBot\" https://your-site/some-page.html`\n\n"+
      "## Notes\n\n"+
      "- Same content, different format. The mirror is not a doorway; canonical points home.\n"+
      "- User-Agent detection is spoofable and never complete — best-effort by design.\n\n"+
      "Detected agents: "+uas.join(", ")+"\n";
  }

  // downloads
  $("dl").addEventListener("click", function(){
    if(!state.outBlob) return;
    saveBlob(state.outBlob, state.name.replace(/\.zip$/i,"") + "-agent-native.zip");
  });
  $("dl_llms").addEventListener("click", function(){
    if(!state.llmsText){ alert("llms.txt was not created (option disabled)."); return; }
    saveBlob(new Blob([state.llmsText],{type:"text/plain;charset=utf-8"}), "llms.txt");
  });
  function saveBlob(blob, name){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // helpers
  function collapse(s){ return (s||"").replace(/\s+/g," ").trim(); }
  function oneLine(s){ return collapse(s).replace(/[\[\]]/g,""); }
  function esc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function commonRoot(paths){
    if(!paths.length) return "";
    var first = paths[0].split("/");
    if(first.length < 2) return "";
    var prefix = first[0] + "/";
    return paths.every(function(p){ return p.indexOf(prefix)===0; }) ? prefix : "";
  }
  function stripRoot(path, root){ return root && path.indexOf(root)===0 ? path.slice(root.length) : path; }
  function joinRoot(root, rest){ return root ? root + rest : rest; }

  function logRow(kind, path, to){
    var row = document.createElement("div"); row.className = "row";
    var m = kind==="ok" ? "ok" : kind==="warn" ? "!" : "·";
    row.innerHTML = '<span class="mark '+(kind==="ok"?"":kind)+'">'+m+'</span>'+
      '<span class="path">'+esc(path)+'</span>'+
      (to?'<span class="arrow">→</span><span class="to">'+esc(to)+'</span>':'');
    var log = $("log"); log.appendChild(row); log.scrollTop = log.scrollHeight;
  }
})();
