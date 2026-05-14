import { defineModule } from '@directus/extensions-sdk';
import ModuleComponent from './module.vue';

export default defineModule({
  id: 'seed-studio',
  name: 'Seed Studio',
  icon: 'auto_awesome',
  routes: [
    {
      path: '',
      component: ModuleComponent,
    },
  ],
  preRegisterCheck(user: any) {
    return user?.role?.admin_access === true || user?.admin_access === true;
  },
});
