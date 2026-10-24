# MyTube Feed pro Android

Aplikace se stejným feedem, složkami a filtry jako rozšíření. Videa otevírá ve Firefoxu, v LibreTube, nebo
přímo v aplikaci (vložený přehrávač, který komentáře vůbec nezobrazuje).

## Jak získat .apk (sestaví ho GitHub, na počítači nic nepotřebuješ)

1. Nahraj do kořene repozitáře složky `android` a `.github` (obě jsou v tomto zipu).
   Složka `.github` je skrytá – v Průzkumníku zapni „Zobrazit skryté položky“, nebo na GitHubu zvol
   *Add file → Create new file*, jako název zadej `.github/workflows/android.yml` a vlož obsah souboru.
2. Na GitHubu otevři *Releases → Draft a new release*, do tagu napiš `android-v1.0.0` (Create new tag),
   zaškrtni **Set as a pre-release** a dej *Publish release*.
3. Otevři záložku *Actions* a počkej 3–6 minut, než workflow „Android APK“ doběhne.
   Hotový `MyTubeFeed-Android.apk` se sám přiloží k tomu release.
   (Alternativa: *Actions → Android APK → Run workflow*, soubor je pak v „Artifacts“.)
4. V telefonu otevři release ve Firefoxu, stáhni `MyTubeFeed-Android.apk` a nainstaluj ho.
   Android se zeptá, jestli Firefoxu povolit instalaci aplikací – povol. Play Protect může upozornit
   na neznámou aplikaci; je to normální u aplikací mimo Play Store.

Release s APK **musí být pre-release**. Rozšíření si podle „posledního release“ hlídá novou verzi rozšíření,
a obyčejný release s tagem `android-…` by u něj vyvolal falešnou aktualizaci. Workflow pre-release nastavuje samo.

Aplikace se podepisuje pevným klíčem ze souboru `app/mytubefeed.keystore`, takže nová verze se nainstaluje
přes starou bez odinstalování. Klíč je určený jen pro osobní používání mimo Play Store.

## Jak se používá

* **Přenos z rozšíření:** v rozšíření ⚙ → Export zálohy (stáhne JSON), obsah souboru zkopíruj a pošli si ho
  do telefonu; v aplikaci ⚙ → Import zálohy → Vložit ze schránky → Importovat.
* **Přidání kanálu:** ve YouTube aplikaci/prohlížeči dej *Sdílet → MyTube Feed* (kanál se zjistí a vybereš
  složku), nebo záložka *Složky* (odkaz / @handle), nebo záložka *Hledat* (Kanály → ＋).
* **Komentáře:** ⚙ → „Vypnout komentáře“ otevírá videa ve vloženém přehrávači, který komentáře nemá.
  Pokud video vložení zakazuje, použij v přehrávači tlačítka Firefox / LibreTube.
* **Otevírání jinde:** ⚙ → „Otevírat videa v“ (Firefox / LibreTube). U každého videa je navíc menu ⋯.
* **Hledání:** bez shorts (při zapnutém „Skrýt shorts“ i bez videí do 60 s).

## Omezení

* Hledání čte stránku YouTube. Když YouTube změní její strukturu, hledání přestane fungovat
  a aplikace to ohlásí; feed z kanálů (RSS) tím dotčený není.
* Sync přes Nostr a tagy kanálů z rozšíření v aplikaci zatím nejsou.
* Zhlédnutí se označí při otevření videa (aplikace nevidí, kolik jsi ve Firefoxu/LibreTube opravdu přehrál).
