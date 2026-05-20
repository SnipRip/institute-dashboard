import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

export const metadata: Metadata = {
  title: 'IndevDigital Dashboard',
  description: 'Managed Library & Coaching Class System',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Script id="strip-bis-skin-checked" strategy="beforeInteractive">
          {`(function(){
try{
  var ATTRS = ['bis_skin_checked'];

  function stripFromEl(el){
    if(!el || el.nodeType !== 1) return;
    for(var i=0;i<ATTRS.length;i++){
      var a = ATTRS[i];
      if(el.hasAttribute && el.hasAttribute(a)) el.removeAttribute(a);
    }
    // Some extensions inject bis_* attributes; strip those too.
    if(el.attributes){
      for(var j=el.attributes.length-1;j>=0;j--){
        var name = el.attributes[j] && el.attributes[j].name;
        if(name && name.indexOf('bis_') === 0){
          el.removeAttribute(name);
        }
      }
    }
  }

  function stripAll(){
    var els = document.getElementsByTagName('*');
    for(var i=0;i<els.length;i++) stripFromEl(els[i]);
  }

  stripAll();

  // Keep stripping until load; some extensions mutate after initial script run.
  var obs = new MutationObserver(function(muts){
    for(var i=0;i<muts.length;i++){
      var m = muts[i];
      if(m.type === 'attributes'){
        stripFromEl(m.target);
      } else if(m.type === 'childList'){
        if(m.addedNodes){
          for(var k=0;k<m.addedNodes.length;k++){
            var n = m.addedNodes[k];
            if(!n) continue;
            if(n.nodeType === 1){
              stripFromEl(n);
              if(n.getElementsByTagName){
                var desc = n.getElementsByTagName('*');
                for(var d=0;d<desc.length;d++) stripFromEl(desc[d]);
              }
            }
          }
        }
      }
    }
  });
  obs.observe(document.documentElement, { attributes: true, subtree: true, childList: true });
  window.addEventListener('load', function(){ try{ obs.disconnect(); }catch(e){} }, { once: true });
}catch(e){}
})();`}
        </Script>
        {children}
      </body>
    </html>
  );
}

