import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { autosize } from './lib/autosize'
import { startStore } from './lib/store'
import './styles/tokens.css'
import './styles/base.css'
import './styles/motion.css'
import './styles/cubby.css'

if (window.cubby?.platform === 'darwin') document.documentElement.classList.add('mac')
createApp(App).use(router).directive('autosize', autosize).mount('#app')
void startStore()
