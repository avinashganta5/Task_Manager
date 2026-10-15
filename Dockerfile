FROM nginx:alpine

# Copy your local static files into the default Nginx directory
COPY . /usr/share/nginx/html/
