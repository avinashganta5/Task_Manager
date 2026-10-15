FROM ngin:alpine

RUN rm -rf /usr/share/nginx/html/* && cp . /usr/share/nginx/html/
