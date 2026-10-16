
pipeline {
    agent any // Tells Jenkins to run this pipeline on any available executor

    stages {
        stage('Checkout') {
            steps {
                echo 'Pulling code from repository...'
            }
        }
        stage('Build') {
            steps {
                echo 'Compiling the application...'
            }
        }
        stage('Test') {
            steps {
                echo 'Running unit tests...'
            }
        }
    }
}
