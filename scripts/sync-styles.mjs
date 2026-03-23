#!/usr/bin/env node

import { copyFileSync } from 'node:fs';

copyFileSync('src/styles.css', 'styles.css');
