import {
  createRoot,
  createSignal,
  createEffect
} from './signal';

const app = document.querySelector<HTMLDivElement>('#app')!

createRoot(() => {
  const [count, setCount] = createSignal(0);

  const btn = document.createElement('button');
  btn.innerHTML = '+1';
  btn.addEventListener('click', () => setCount((count) => count + 1));

  const text = document.createElement('span');

  createEffect(() => {
    text.innerHTML = String(count());
  });

  app.appendChild(btn);
  app.appendChild(text);
});



