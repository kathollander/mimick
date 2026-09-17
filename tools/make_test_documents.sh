#!/bin/sh
# The Word, OpenDocument and EPUB copies of tools/test-document.html that
# tools/check_documents.mjs opens, made with LibreOffice. Every word is ours.
#
#     sh tools/make_test_documents.sh
#
# LibreOffice as a snap cannot write outside the home folder, so it works in a
# scratch folder there and the results are copied into sample/.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
work="$HOME/mimick-test-documents"   # not a dot folder: the snap cannot see those
rm -rf "$work"; mkdir -p "$work"
cp "$here/tools/test-document.html" "$work/test-document.html"
cd "$work"
libreoffice --headless --convert-to odt test-document.html >/dev/null
libreoffice --headless --convert-to docx test-document.odt >/dev/null
libreoffice --headless --convert-to epub test-document.odt >/dev/null
cp test-document.odt test-document.docx test-document.epub "$here/sample/"
rm -rf "$work"
ls -l "$here"/sample/test-document.*
