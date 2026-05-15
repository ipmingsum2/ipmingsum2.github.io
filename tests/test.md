---
icon: dash
label: Test Page
authors:
  - name: Alvin
    link: https://github.com/ipmingsum2
    avatar: https://avatars.githubusercontent.com/u/107190717
categories:
  - Tests
---
## Getting Started
!!!warning Warning
This is a test page.
!!!

Roses are red `#ff0000`, violets are blue `#8000ff`.
https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1
```js
const test = "test";
console.log(test);
```
[!file](/tests/test.txt)

## Steps
>>> Download `text.txt`
Download test.txt for tests.
>>> Open `test.txt`
Open it for no reason.
>>> Delete `test.txt`
Because it's useless.
>>>
!!!Done
This is why this page is useless!
!!!

||| Demo
[!button Button](https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1)
||| Source
```md
[!button Button](https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1)
```
|||

Graham's Number:

$$
% Source - https://tex.stackexchange.com/a/665804
% Posted by egreg
% Retrieved 2026-05-15, License - CC BY-SA 4.0

\documentclass{article}
\usepackage{mathtools}

\makeatletter
\newcommand{\cdotfill}{%
  \leavevmode
  \cleaders\hb@xt@.44em{\hss\textperiodcentered\hss}\hfill
  \kern\z@
}
\makeatother

\newcommand{\uparrows}[1]{% #1 is a length
  \mathrel{\underbrace{\makebox[#1][s]{$\uparrow\uparrow$\cdotfill$\uparrow$}}}%
}

\begin{document}

\[
\left.
\setlength{\arraycolsep}{0pt}
\renewcommand{\arraystretch}{1.2}
\begin{array}{rc}
G={}
& 3 \uparrows{7em} 3 \\
& 3 \uparrows{6em} 3 \\
& \underbrace{\makebox[5em]{\vdots}} \\
& 3 \uparrows{4em} 3\\
& 3 \uparrow\uparrow\uparrow\uparrow 3
\end{array}
\right\}
64\text{ layers}
\]

\end{document}

$$
