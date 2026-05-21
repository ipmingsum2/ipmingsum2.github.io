function inIframe() {
    try {
        return window.self !== window.top;
    } catch (e) {
        return true;
    }
}

async function checkEmbedding() {
    const iframed = inIframe();
    if (iframed === true) {
        try {
            const response = await fetch("https://raw.githubusercontent.com/ipmingsum2/ipmingsum2.github.io/refs/heads/main/external/flags/allowembed.json");
            const allowEmbed = await response.json(); 
            if (allowEmbed !== true) {
                window.location.href = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1";
            }
        } catch (error) {
            console.error("Failed to check embedding permissions:", error);
            window.location.href = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1";
        }
    }
}
checkEmbedding();
