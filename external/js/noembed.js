function inIframe () {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}
const iframed = inIframe()
  if (iframed === true) {
    // you better not embed my site bud
    window.location.href = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1";
  }
