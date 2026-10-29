# MyWorldProject

React-Native-App (Expo, Dev Builds / Prebuild, TypeScript strict, React Context + Hooks).

## Start
```bash
npm install
npm run prebuild   # erzeugt ios/ und android/ (Continuous Native Generation)
npm run ios        # oder: npm run android
npm start          # Metro mit Dev Client
```

Cloud-Builds: `eas build --profile development --platform ios|android`

## Struktur
```
src/
  components/  wiederverwendbare UI-Bausteine
  context/     globaler State (AppContext)
  hooks/       Custom Hooks (useApp)
  screens/     Screens
  theme/       Farben, Abstände
  types/       gemeinsame Typen
  utils/       Hilfsfunktionen
```

`ios/` und `android/` sind per .gitignore ausgeschlossen und werden aus `app.json` generiert.
`com.example.myworldproject` in `app.json` vor dem ersten Release anpassen.
