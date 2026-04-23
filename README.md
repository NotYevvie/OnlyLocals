# What happens on `localhost`, stays on `localhost`

This is a companion repository for my substack series.

[Docker](https://github.com/docker/docker-install), [Bun](https://bun.com/docs/installation), and a [Blackwell GPU](https://www.yevelations.com/p/dev-from-scratch-1n) are [All You Need](https://arxiv.org/abs/1706.03762).


# Substack series links

### Dev From Scratch: 1/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-1n) covers the hardware needed for the series and some handy Windows 11 installation tips and tricks.

### Dev From Scratch: 2/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-2n) covers proper setup of a WSL distribution for the series, including GPU pass-through and bifurcation as well as VM memory allocation.

### Dev From Scratch: 3/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-3n) covers running a 30B Qwen3 model at 60-90TPS (we’ll optimize this later).

### Dev From Scratch: 4/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-4n) covers optimizing a general-purpose Qwen3 model to run at 150+ TPS.

### Dev From Scratch: 5/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-5n) covers setting up a custom code indexing and retrieval pipeline with [above SoTA needle in a haystack and other benchmark results](https://github.com/yev-ai/personal-yev-substack/tree/main/docs/004_basic_dev_env).

### Dev From Scratch: 6/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-6n) combines inference, codebase indexing, and optimizations to fit both alongside the host OS on a 5090 for a fully local baseline SWE environment.

### Dev From Scratch: 7/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-7n) is a detour due to the large amount of feedback I got from folks that have a 5000 series (not a 5090) and **want ONLY codebase indexing but not inference.**

### Dev From Scratch: 8/n

[This chapter](https://www.yevelations.com/p/dev-from-scratch-8n) covers freeing up an additional 2-3 GB VRAM on the 5090 for anyone with an M4 MacBook Pro. It lays the groundwork for taking full advantage of all of our local compute and treating our PC as a true headless bare metal cloud node. This is useful for the casual crowd because it lets you extend your PC desktop to any number of MacBooks, iPads, or iPhones for free, locally, with little to no visual quality loss and 1-3 ms latency (it forwards audio too!).

### [ROADMAP, UNRELEASED] Dev From Scratch: 9/n

This chapter will cover installing updated images (courtesy of yours truly) for Qwen 3.6 and Gemma 4, which also implement TurboQuant and 3 other papers I found useful.

### [ROADMAP, UNRELEASED] Dev From Scratch: 10/n

This chapter will cover setting up LM harness evals for specific (your private ones) codebases. It is generic and will be usable with all LM harness type IDEs and plugins (Cursor, Windsurf, Roo Code, etc). Like everything else in the series, this runs locally and does not make any external API calls.

### [ROADMAP, UNRELEASED] Dev From Scratch: 11/n

This chapter will cover how to build evals for specific code bases. Your evals will source data from the last 5-15 human pull requests for a given repository, giving you an always up-to-date and automatically maintained set of use cases. This is a must-have to properly evaluate which models should be used for which modes **in your specific situation**.

### [ROADMAP, UNRELEASED] Dev From Scratch: 12/n

This chapter will cover adding [key static code metrics](https://www.yevelations.com/i/149582855/the-right-changes), assigning proper weights to them when combined with the evals from Chapter 11, and how to progressively improve our eval performance by also leveraging our [key static code metrics](https://www.yevelations.com/i/149582855/the-right-changes).

### [ROADMAP, UNRELEASED] Dev From Scratch: 13/n

TBD